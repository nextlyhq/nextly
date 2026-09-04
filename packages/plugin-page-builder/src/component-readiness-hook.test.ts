/**
 * When an author is told their published page points at components that are not.
 *
 * Asserted through what reaches the advisory channel, because that is the whole
 * product: the write has already committed when this runs, so a notice that is
 * not recorded is indistinguishable from the behaviour before it existed.
 */
import { COMPONENT_INSTANCE_TYPE } from "@nextlyhq/blocks-engine";
import { beforeEach, describe, expect, it, vi } from "vitest";

const recorded: unknown[] = [];

vi.mock("nextly", async importOriginal => {
  // The real module SPREAD, so an export this file does not name stays itself.
  // A closed literal answers `undefined` for everything it omits, which turns
  // an unrelated import in the subject into a failure that reads as a fault
  // here rather than as a stale list.
  const real = await importOriginal<Record<string, unknown>>();
  return {
    ...real,
    recordAdvisoryNotice: (notice: unknown) => recorded.push(notice),
  };
});

const { registerComponentReadinessNotice, COMPONENTS_NOT_PUBLISHED_CODE } =
  await import("./component-readiness-hook");

const COMPONENTS = "nx_pb_components";
const LIMITS = { maxDepth: 12, maxNodes: 5000, maxBytes: 2_097_152 };

const doc = (componentIds: string[]) => ({
  formatVersion: 1,
  kind: "page",
  nodes: componentIds.map((componentId, i) => ({
    id: `i${String(i)}`,
    type: COMPONENT_INSTANCE_TYPE,
    version: 1,
    props: { componentId },
  })),
});

/**
 * A harness registering the hook and returning the one handler it wires.
 *
 * `published` is what the component store answers for under a published scope;
 * anything asked for and absent from it is what the notice is about.
 */
function harness(
  options: {
    published?: string[];
    pageFields?: unknown[];
    componentStoreLocalized?: boolean;
  } = {}
) {
  const handlers: ((ctx: unknown) => unknown)[] = [];
  const finds: Record<string, unknown>[] = [];
  const ctx = {
    hooks: {
      on: (
        _type: string,
        _collection: string,
        handler: (c: unknown) => unknown
      ) => {
        handlers.push(handler);
      },
    },
    services: {
      collections: {
        getCollection: async (name: string) =>
          name === COMPONENTS
            ? {
                fields: [],
                localized: options.componentStoreLocalized === true,
              }
            : {
                fields: options.pageFields ?? [
                  { name: "content", type: "blocks" },
                ],
              },
      },
    },
  };
  registerComponentReadinessNotice({
    ctx: ctx as never,
    componentCollection: COMPONENTS,
    limits: () => LIMITS,
  });
  const nextly = {
    find: async (args: Record<string, unknown>) => {
      finds.push(args);
      const live = new Set(options.published ?? []);
      const wanted =
        ((args.where as { id?: { in?: string[] } })?.id?.in as string[]) ?? [];
      return { items: wanted.filter(id => live.has(id)).map(id => ({ id })) };
    },
  };
  return { handlers, finds, nextly };
}

const writeContext = (over: Record<string, unknown> = {}) => ({
  type: "afterUpdate",
  collection: "pages",
  data: { id: "p1", status: "published", content: doc(["hero"]) },
  req: {},
  ...over,
});

beforeEach(() => {
  recorded.length = 0;
});

describe("the publish-readiness notice", () => {
  it("reports a published page embedding a component that is not live", async () => {
    const h = harness({ published: [] });
    const ctx = writeContext();
    (ctx.req as Record<string, unknown>).nextly = h.nextly;

    await h.handlers[0]!(ctx);

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      code: COMPONENTS_NOT_PUBLISHED_CODE,
      collection: "pages",
      entryId: "p1",
    });
    expect((recorded[0] as { message: string }).message).toContain(
      "1 component"
    );
  });

  it("says nothing when every embedded component is live", async () => {
    const h = harness({ published: ["hero"] });
    const ctx = writeContext();
    (ctx.req as Record<string, unknown>).nextly = h.nextly;

    await h.handlers[0]!(ctx);

    expect(recorded).toEqual([]);
  });

  it("says nothing about a page left as a DRAFT", async () => {
    // Publishing the page is what puts the hole in front of visitors. A draft
    // page whose components are also drafts is an ordinary work in progress,
    // and warning about it would fire on nearly every save.
    const h = harness({ published: [] });
    const ctx = writeContext({
      data: { id: "p1", status: "draft", content: doc(["hero"]) },
    });
    (ctx.req as Record<string, unknown>).nextly = h.nextly;

    await h.handlers[0]!(ctx);

    expect(recorded).toEqual([]);
  });

  it("fires on a later edit, not only on the save that published", async () => {
    // The state the write LEAVES BEHIND. An author dropping an unpublished
    // component into an already-live page is the case most worth catching, and
    // a rule watching for the draft-to-published transition would miss it —
    // the admin sends `status` on every save, so nothing distinguishes this
    // write from any other edit of a live page.
    const h = harness({ published: [] });
    const ctx = writeContext({
      data: { id: "p1", status: "published", content: doc(["late-addition"]) },
      previousData: { id: "p1", status: "published" },
    });
    (ctx.req as Record<string, unknown>).nextly = h.nextly;

    await h.handlers[0]!(ctx);

    expect(recorded).toHaveLength(1);
  });

  it("stays silent when the component store is LOCALIZED", async () => {
    // Publishing is per language on a companion row there, so a
    // published-scoped read answers for no language in particular and would
    // report live components as missing. A notice that fires on a case it
    // cannot decide is one authors learn to dismiss.
    const h = harness({ published: [], componentStoreLocalized: true });
    const ctx = writeContext();
    (ctx.req as Record<string, unknown>).nextly = h.nextly;

    await h.handlers[0]!(ctx);

    expect(recorded).toEqual([]);
    expect(h.finds).toEqual([]);
  });

  it("declines inside a caller-owned transaction", async () => {
    // The hook runs before the caller commits and cannot join that transaction,
    // so it would read a database without this write in it and describe the
    // document's previous state.
    const h = harness({ published: [] });
    const ctx = writeContext({ executor: {} });
    (ctx.req as Record<string, unknown>).nextly = h.nextly;

    await h.handlers[0]!(ctx);

    expect(recorded).toEqual([]);
  });

  it("declines for a Single", async () => {
    const h = harness({ published: [] });
    const ctx = writeContext({ collection: "single:homepage" });
    (ctx.req as Record<string, unknown>).nextly = h.nextly;

    await h.handlers[0]!(ctx);

    expect(recorded).toEqual([]);
  });

  it("says nothing for a collection with no blocks field", async () => {
    const h = harness({
      published: [],
      pageFields: [{ name: "title", type: "text" }],
    });
    const ctx = writeContext();
    (ctx.req as Record<string, unknown>).nextly = h.nextly;

    await h.handlers[0]!(ctx);

    expect(recorded).toEqual([]);
    expect(h.finds).toEqual([]);
  });

  it("asks the store under a PUBLISHED scope, trusted", async () => {
    // The scope IS the rule: which states count as public is the workflow's
    // question and the query service answers it. `overrideAccess` because an
    // author who cannot read a component still needs to know their page has a
    // hole — judging it by their permissions answers "missing" for one that is
    // perfectly live.
    const h = harness({ published: [] });
    const ctx = writeContext();
    (ctx.req as Record<string, unknown>).nextly = h.nextly;

    await h.handlers[0]!(ctx);

    expect(h.finds).toHaveLength(1);
    expect(h.finds[0]).toMatchObject({
      collection: COMPONENTS,
      status: "published",
      overrideAccess: true,
    });
  });

  it("never raises, whatever the read does", async () => {
    // A raise from an `after*` phase is how a hook reports that a side effect
    // BROKE, and the registry files it as one — so a failure here would reach
    // the caller as a failed publish, about a write that committed cleanly.
    const h = harness({ published: [] });
    const ctx = writeContext();
    (ctx.req as Record<string, unknown>).nextly = {
      find: () => Promise.reject(new Error("store unreachable")),
    };

    await expect(h.handlers[0]!(ctx)).resolves.toBeUndefined();
    expect(recorded).toEqual([]);
  });

  it("counts a component embedded twice as one", async () => {
    const h = harness({ published: [] });
    const ctx = writeContext({
      data: { id: "p1", status: "published", content: doc(["hero", "hero"]) },
    });
    (ctx.req as Record<string, unknown>).nextly = h.nextly;

    await h.handlers[0]!(ctx);

    expect((recorded[0] as { message: string }).message).toContain(
      "1 component"
    );
  });
});
