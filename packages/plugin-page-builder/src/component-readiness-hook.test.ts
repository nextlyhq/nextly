/**
 * When an author is told their published page points at components that are not.
 *
 * Asserted through what reaches the advisory channel, because that is the whole
 * product: the write has already committed when this runs, so a notice that is
 * not recorded is indistinguishable from the behaviour before it existed.
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
} from "@nextlyhq/blocks-engine";
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
  formatVersion: DOCUMENT_FORMAT_VERSION,
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
    /** Ids the store answers for under a published scope. */
    published?: string[];
    /** What each published component's OWN document embeds, by id. */
    nested?: Record<string, string[]>;
    pageFields?: unknown[];
    componentStoreLocalized?: boolean;
    /** Whether the written collection owns the Draft/Published lifecycle. */
    pageHasLifecycle?: boolean;
    /** Whether the written collection is localized. */
    pageLocalized?: boolean;
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
                status: true,
                localized: options.componentStoreLocalized === true,
                // The store's own blocks field, which is how a nested
                // component is found inside a published definition.
                fields: [{ name: "content", type: "blocks" }],
              }
            : {
                status: options.pageHasLifecycle !== false,
                localized: options.pageLocalized === true,
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
    componentField: "content",
    limits: () => LIMITS,
  });
  const nextly = {
    find: async (args: Record<string, unknown>) => {
      finds.push(args);
      const live = new Set(options.published ?? []);
      const wanted =
        ((args.where as { id?: { in?: string[] } })?.id?.in as string[]) ?? [];
      return {
        items: wanted
          .filter(id => live.has(id))
          // `kind: "component"`, because that is what the resolver will accept
          // as a definition. A page-kind document here is read as unreadable
          // rather than as a component, so every nesting assertion would pass
          // by finding a hole that the shape, not the data, produced.
          .map(id => ({
            id,
            content: {
              formatVersion: DOCUMENT_FORMAT_VERSION,
              kind: "component",
              nodes: (options.nested?.[id] ?? []).map((componentId, i) => ({
                id: `n${id}${String(i)}`,
                type: COMPONENT_INSTANCE_TYPE,
                version: 1,
                props: { componentId },
              })),
            },
          })),
      };
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
    // The other half of the same question: a page write still says "page".
    // Without this, hardcoding "component" everywhere would pass the assertion
    // above while renaming every notice an author sees.
    expect((recorded[0] as { message: string }).message).toContain(
      "This page embeds"
    );
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

describe("the cases review found this getting wrong", () => {
  it("follows a PUBLISHED component into the unpublished one it embeds", async () => {
    // The page embeds only `outer`, which is live — so a check that stopped at
    // the ids stored in the page verified it, found it published and said
    // nothing, while the renderer inlines `outer` and meets the same hole one
    // level down. The visitor sees a marker nobody was warned about.
    const h = harness({ published: ["outer"], nested: { outer: ["inner"] } });
    const ctx = writeContext({
      data: { id: "p1", status: "published", content: doc(["outer"]) },
    });
    (ctx.req as Record<string, unknown>).nextly = h.nextly;

    await h.handlers[0]!(ctx);

    expect(recorded).toHaveLength(1);
    expect((recorded[0] as { message: string }).message).toContain(
      "1 component"
    );
  });

  it("does NOT descend through a component that is itself unpublished", async () => {
    // The renderer never inlines it, so whatever it references in turn is
    // unreachable. Counting those would report components no visitor could
    // encounter, and inflate the number in the sentence the author reads.
    const h = harness({ published: [], nested: { outer: ["inner"] } });
    const ctx = writeContext({
      data: { id: "p1", status: "published", content: doc(["outer"]) },
    });
    (ctx.req as Record<string, unknown>).nextly = h.nextly;

    await h.handlers[0]!(ctx);

    expect((recorded[0] as { message: string }).message).toContain(
      "1 component"
    );
  });

  it("terminates on a component graph that contains a cycle", async () => {
    // Authored data, so a cycle is legal input rather than a bug to assume
    // away. Without the visited set this walks until the depth bound stops it,
    // re-reading the same rows on every round.
    const h = harness({
      published: ["a", "b"],
      nested: { a: ["b"], b: ["a"] },
    });
    const ctx = writeContext({
      data: { id: "p1", status: "published", content: doc(["a"]) },
    });
    (ctx.req as Record<string, unknown>).nextly = h.nextly;

    await h.handlers[0]!(ctx);

    expect(recorded).toEqual([]);
    // Two rounds: `a`, then `b`. A third would mean the visited set is not
    // holding and the walk is only bounded by depth.
    expect(h.finds).toHaveLength(2);
  });

  it("says nothing for a collection WITHOUT the publish lifecycle", async () => {
    // `status` is an ordinary field name a project may use for its own
    // vocabulary, so the name answers nothing on its own: a collection with no
    // Draft/Published lifecycle whose rows read `status: "published"` has
    // published nothing, and an advisory there is pure noise.
    const h = harness({ published: [], pageHasLifecycle: false });
    const ctx = writeContext();
    (ctx.req as Record<string, unknown>).nextly = h.nextly;

    await h.handlers[0]!(ctx);

    expect(recorded).toEqual([]);
    expect(h.finds).toEqual([]);
  });

  it("says nothing on a WORKING-DRAFT save of a live page", async () => {
    // A pending draft on a published document keeps the live parent's
    // `status`, so by its own fields it is indistinguishable from a real
    // publish — while the document a visitor loads did not change at all.
    // Without this the notice fires on ordinary drafting of a live page, which
    // is most of an author's day.
    const h = harness({ published: [] });
    const ctx = writeContext({
      data: {
        id: "p1",
        status: "published",
        _isWorkingDraft: true,
        content: doc(["hero"]),
      },
    });
    (ctx.req as Record<string, unknown>).nextly = h.nextly;

    await h.handlers[0]!(ctx);

    expect(recorded).toEqual([]);
  });

  it("reports the phase it was REGISTERED for", async () => {
    // A `HookContext` names its `operation`, never the phase, so a phase read
    // off the context is always the same value whichever handler ran — and a
    // consumer branching or deduplicating on it sees create-time advisories
    // labelled as updates.
    const h = harness({ published: [] });
    const ctx = writeContext({ operation: "create" });
    (ctx.req as Record<string, unknown>).nextly = h.nextly;

    // Handler 0 is `afterCreate`; handler 1 is `afterUpdate`.
    await h.handlers[0]!(ctx);

    expect(recorded[0]).toMatchObject({ phase: "afterCreate" });
  });

  it("chunks the lookup below the collection query cap", async () => {
    // A collection query is clamped to 500 rows and returns a subset SILENTLY,
    // while a document may reference far more instances than that. Asking for
    // all of them at once reports every published component past the first page
    // as unpublished — a false warning produced by the read, not the data.
    const ids = Array.from({ length: 300 }, (_, i) => `c${String(i)}`);
    const h = harness({ published: ids });
    const ctx = writeContext({
      data: { id: "p1", status: "published", content: doc(ids) },
    });
    (ctx.req as Record<string, unknown>).nextly = h.nextly;

    await h.handlers[0]!(ctx);

    expect(recorded).toEqual([]);
    expect(h.finds.length).toBeGreaterThan(1);
    for (const find of h.finds) {
      const wanted = (find.where as { id?: { in?: string[] } }).id?.in ?? [];
      expect(wanted.length).toBeLessThanOrEqual(128);
    }
  });
});

describe("the store the notice judges a page against", () => {
  it("can be pointed at the collection the renderer actually reads", async () => {
    // `createBlocksPage` accepts `componentCollection`, and the route is
    // configured in the host's app where this write-path hook cannot see it. A
    // host that redirected the renderer must be able to redirect this too, or
    // the notice judges the page against a store it does not render from and
    // reports live components as missing.
    const OTHER = "house_components";
    const handlers: ((ctx: unknown) => unknown)[] = [];
    const asked: string[] = [];
    const ctx = {
      hooks: {
        on: (_t: string, _c: string, handler: (c: unknown) => unknown) => {
          handlers.push(handler);
        },
      },
      services: {
        collections: {
          getCollection: async (name: string) => ({
            status: true,
            fields: [{ name: "content", type: "blocks" }],
            localized: false,
            __name: name,
          }),
        },
      },
    };
    registerComponentReadinessNotice({
      ctx: ctx as never,
      componentCollection: OTHER,
      componentField: "content",
      limits: () => LIMITS,
    });
    const write = writeContext();
    (write.req as Record<string, unknown>).nextly = {
      find: async (args: Record<string, unknown>) => {
        asked.push(args.collection as string);
        return { items: [] };
      },
    };

    await handlers[0]!(write);

    expect(asked).toEqual([OTHER]);
  });
});

describe("asking the resolver rather than walking stored nodes", () => {
  it("does NOT report a condition-gated instance", async () => {
    // The discriminating case for the whole approach. A gated instance is a
    // node the walk reports and the resolver never asks for, so a check built
    // on a walk warns about a component no visitor encounters — and this is
    // the exact disagreement the renderer's own discovery was written to
    // delete. Reported here, it would be a warning about a page that renders
    // correctly.
    const h = harness({ published: [] });
    const ctx = writeContext({
      data: {
        id: "p1",
        status: "published",
        content: {
          formatVersion: DOCUMENT_FORMAT_VERSION,
          kind: "page",
          nodes: [
            {
              id: "g",
              type: COMPONENT_INSTANCE_TYPE,
              version: 1,
              props: { componentId: "hero" },
              visibility: {
                conditions: [[{ field: "tier", op: "eq", value: "vip" }]],
              },
            },
          ],
        },
      },
    });
    (ctx.req as Record<string, unknown>).nextly = h.nextly;

    await h.handlers[0]!(ctx);

    expect(recorded).toEqual([]);
    // The stronger half: the store was never even ASKED about it. A walk-based
    // check would have queried for `hero` and then reported it, so an empty
    // query log is what separates asking the resolver from asking a traversal.
    expect(h.finds).toEqual([]);
  });

  it("reads only the component field the renderer reads", async () => {
    // A store may carry more than one blocks field. The renderer reads exactly
    // one — `componentField`, defaulting to `content` — so counting references
    // in a field it never loads reports a page as holed while it draws fine.
    const handlers: ((c: unknown) => unknown)[] = [];
    const ctx = {
      hooks: {
        on: (_t: string, _c: string, handler: (c: unknown) => unknown) => {
          handlers.push(handler);
        },
      },
      services: {
        collections: {
          getCollection: async () => ({
            status: true,
            localized: false,
            fields: [
              { name: "content", type: "blocks" },
              { name: "notes", type: "blocks" },
            ],
          }),
        },
      },
    };
    registerComponentReadinessNotice({
      ctx: ctx as never,
      componentCollection: COMPONENTS,
      componentField: "content",
      limits: () => LIMITS,
    });
    const write = writeContext({
      data: { id: "p1", status: "published", content: doc(["hero"]) },
    });
    (write.req as Record<string, unknown>).nextly = {
      find: async () => ({
        // `hero` is live, and its document sits in the field the renderer
        // reads. A check taking `notes` instead sees no document and calls a
        // published component missing.
        items: [
          {
            id: "hero",
            content: {
              formatVersion: DOCUMENT_FORMAT_VERSION,
              kind: "component",
              nodes: [],
            },
            // Deliberately DIFFERENT from `content`: this field references a
            // component nothing published. The two fields therefore give
            // opposite answers, which is what lets this test tell which one
            // was read — with the same document in both, reading either passes.
            notes: {
              formatVersion: DOCUMENT_FORMAT_VERSION,
              kind: "component",
              nodes: [
                {
                  id: "x",
                  type: COMPONENT_INSTANCE_TYPE,
                  version: 1,
                  props: { componentId: "never-published" },
                },
              ],
            },
          },
        ],
      }),
    };

    await handlers[0]!(write);

    expect(recorded).toEqual([]);
  });
});

describe("what a post-commit hook actually receives", () => {
  it("decodes a blocks field the adapter stored as TEXT", async () => {
    // JSON columns come back as strings on SQLite and any adapter that stores
    // them that way, and the write path parses them AFTER these hooks run. An
    // object-only test therefore finds no documents at all on those adapters
    // and reports nothing for every page — silently, because "nothing to look
    // at" and "nothing wrong" are the same answer here.
    const h = harness({ published: [] });
    const ctx = writeContext({
      data: {
        id: "p1",
        status: "published",
        content: JSON.stringify(doc(["hero"])),
      },
    });
    (ctx.req as Record<string, unknown>).nextly = h.nextly;

    await h.handlers[0]!(ctx);

    expect(recorded).toHaveLength(1);
  });

  it("treats a string that is not a document as no document", async () => {
    const h = harness({ published: [] });
    const ctx = writeContext({
      data: { id: "p1", status: "published", content: "not json at all" },
    });
    (ctx.req as Record<string, unknown>).nextly = h.nextly;

    await h.handlers[0]!(ctx);

    expect(recorded).toEqual([]);
  });

  it("says nothing for a LOCALIZED page collection", async () => {
    // A localized document publishes per language on a companion row, and
    // `_status` is a companion-only column the write path deliberately does not
    // merge into the document its hooks receive. The main row's `status`
    // therefore answers for no language in particular — a page whose Spanish
    // translation just went live still reads `draft` here. The same rule
    // already skips the component store when IT is localized.
    const h = harness({ published: [], pageLocalized: true });
    const ctx = writeContext();
    (ctx.req as Record<string, unknown>).nextly = h.nextly;

    await h.handlers[0]!(ctx);

    expect(recorded).toEqual([]);
    expect(h.finds).toEqual([]);
  });

  it("reads only the PAGE field the route renders, when one is named", async () => {
    const handlers: ((c: unknown) => unknown)[] = [];
    const finds: Record<string, unknown>[] = [];
    const ctx = {
      hooks: {
        on: (_t: string, _c: string, handler: (c: unknown) => unknown) => {
          handlers.push(handler);
        },
      },
      services: {
        collections: {
          getCollection: async () => ({
            status: true,
            localized: false,
            fields: [
              { name: "content", type: "blocks" },
              { name: "sidebar", type: "blocks" },
            ],
          }),
        },
      },
    };
    registerComponentReadinessNotice({
      ctx: ctx as never,
      componentCollection: COMPONENTS,
      componentField: "content",
      pageField: "content",
      limits: () => LIMITS,
    });
    const write = writeContext({
      data: {
        id: "p1",
        status: "published",
        // The rendered field is clean; the one the route never draws is not.
        content: doc([]),
        sidebar: doc(["never-published"]),
      },
    });
    (write.req as Record<string, unknown>).nextly = {
      find: async (args: Record<string, unknown>) => {
        finds.push(args);
        return { items: [] };
      },
    };

    await handlers[0]!(write);

    expect(recorded).toEqual([]);
    expect(finds).toEqual([]);
  });
});

describe("what the notice is allowed to claim", () => {
  it("keeps a published-but-unreadable definition PRESENT", async () => {
    // The row came back under a published scope, so somebody published it.
    // Dropping it would report the component as one nobody published — a
    // diagnosis republishing cannot repair. Presence and readability are
    // separate questions and the resolver reports them as different reasons.
    const handlers: ((c: unknown) => unknown)[] = [];
    const ctx = {
      hooks: {
        on: (_t: string, _c: string, h: (c: unknown) => unknown) => {
          handlers.push(h);
        },
      },
      services: {
        collections: {
          getCollection: async () => ({
            status: true,
            localized: false,
            fields: [{ name: "content", type: "blocks" }],
          }),
        },
      },
    };
    registerComponentReadinessNotice({
      ctx: ctx as never,
      componentCollection: COMPONENTS,
      componentField: "content",
      limits: () => LIMITS,
    });
    const write = writeContext();
    (write.req as Record<string, unknown>).nextly = {
      // Published, and its document is garbage.
      find: async () => ({ items: [{ id: "hero", content: { nope: true } }] }),
    };

    await handlers[0]!(write);

    expect(recorded).toEqual([]);
  });

  it("clears BOTH identity channels on the store read", async () => {
    // `mergeConfig` spreads the pooled reader's defaults UNDER the call, so an
    // omitted key restores whatever identity the instance was booted with, and
    // an `afterRead` hook branching on the caller would hand this read a
    // definition the anonymous visitor never sees.
    const h = harness({ published: [] });
    const ctx = writeContext();
    (ctx.req as Record<string, unknown>).nextly = h.nextly;

    await h.handlers[0]!(ctx);

    const read = h.finds[0]!;
    expect("user" in read).toBe(true);
    expect(read.user).toBeUndefined();
    expect("req" in read).toBe(true);
    expect(read.req).toBeUndefined();
  });

  it("says nothing about a collection no route renders", async () => {
    const h = harness({ published: [] });
    const handlers: ((c: unknown) => unknown)[] = [];
    const ctx = {
      hooks: {
        on: (_t: string, _c: string, x: (c: unknown) => unknown) => {
          handlers.push(x);
        },
      },
      services: {
        collections: {
          getCollection: async () => ({
            status: true,
            localized: false,
            fields: [{ name: "content", type: "blocks" }],
          }),
        },
      },
    };
    registerComponentReadinessNotice({
      ctx: ctx as never,
      componentCollection: COMPONENTS,
      componentField: "content",
      renderedCollections: ["pages"],
      limits: () => LIMITS,
    });
    const write = writeContext({ collection: "snippets" });
    (write.req as Record<string, unknown>).nextly = h.nextly;

    await handlers[0]!(write);

    expect(recorded).toEqual([]);
  });
});

describe("a write to the component store itself", () => {
  it("reads the COMPONENT field, not the route's page field", async () => {
    // A component definition is not a page, and the page field does not
    // describe it. A host whose pages render `layout` while definitions live in
    // `content` would have every component write filtered to a field the store
    // does not declare — nothing examined, and a component embedding an
    // unpublished sibling publishing in silence, on the one path this hook
    // keeps in scope precisely because that hole appears on every page
    // embedding it.
    const handlers: ((c: unknown) => unknown)[] = [];
    const ctx = {
      hooks: {
        on: (_t: string, _c: string, h: (c: unknown) => unknown) => {
          handlers.push(h);
        },
      },
      services: {
        collections: {
          getCollection: async () => ({
            status: true,
            localized: false,
            fields: [{ name: "content", type: "blocks" }],
          }),
        },
      },
    };
    registerComponentReadinessNotice({
      ctx: ctx as never,
      componentCollection: COMPONENTS,
      componentField: "content",
      // The route renders a DIFFERENT field on its pages.
      pageField: "layout",
      limits: () => LIMITS,
    });
    const write = writeContext({
      collection: COMPONENTS,
      data: { id: "outer", status: "published", content: doc(["inner"]) },
    });
    (write.req as Record<string, unknown>).nextly = {
      find: async () => ({ items: [] }),
    };

    await handlers[0]!(write);

    expect(recorded).toHaveLength(1);
    // Named for what was WRITTEN. A component definition is kept in scope on
    // purpose — the hole it leaves shows on every page embedding it — and
    // telling its author "this page embeds..." points them at a document they
    // were not editing.
    expect((recorded[0] as { message: string }).message).toContain(
      "This component embeds"
    );
  });
});

describe("reading definitions the way the renderer reads them", () => {
  it("does not force a relationship depth", async () => {
    // The renderer's own component read states no `depth`, so the collection
    // service expands to its default before running `afterRead`. Forcing zero
    // here hands those hooks bare ids, and a hook whose blocks output depends
    // on an expanded relationship then yields a different component graph than
    // the page draws — missing an unpublished component, or naming one no
    // visitor meets.
    const h = harness({ published: [] });
    const ctx = writeContext();
    (ctx.req as Record<string, unknown>).nextly = h.nextly;

    await h.handlers[0]!(ctx);

    expect(h.finds).toHaveLength(1);
    expect("depth" in h.finds[0]!).toBe(false);
  });
});
