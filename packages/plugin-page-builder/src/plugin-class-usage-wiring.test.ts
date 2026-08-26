/**
 * Whether installing the plugin actually installs class-usage maintenance.
 *
 * Every other test in this area exercises the maintenance modules directly, so
 * all of them pass with the registration call deleted from `init` — measured:
 * removing it compiles and leaves the whole suite green. A host would then
 * install the plugin, get the index TABLE and nothing that writes to it, and
 * every class on the site would read as unused with no error anywhere.
 *
 * This is the one assertion that fails when the wiring is absent.
 *
 * @module plugin-class-usage-wiring.test
 */
import { describe, expect, it, vi } from "vitest";

import { UNDETERMINED_CLASS_ID } from "./class-usage-reconcile";
import { pageBuilder } from "./plugin";

/** The parts of a plugin context `init` reaches for, and nothing more. */
function initContext(renameMap: Record<string, string> = {}) {
  const registered: string[] = [];
  const handlers: ((c: Record<string, unknown>) => unknown)[] = [];
  const ctx = {
    // What `.rename()` resolves to. Identity when nothing was renamed, which is
    // the shape core builds for every plugin.
    self: {
      collections: {
        nx_pb_class_usage: renameMap.nx_pb_class_usage ?? "nx_pb_class_usage",
      },
      singles: {},
      name: "@nextlyhq/plugin-page-builder",
    },
    hooks: {
      on: (
        type: string,
        collection: string,
        handler: (c: Record<string, unknown>) => unknown
      ) => {
        registered.push(`${type}:${collection}`);
        handlers.push(handler);
      },
      off: vi.fn(),
      onBeforeOperation: vi.fn(),
      offBeforeOperation: vi.fn(),
    },
    services: {
      collections: { getCollection: vi.fn(async () => ({})) },
      plugins: {},
    },
    config: {},
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  };
  return { ctx, registered, handlers };
}

describe("installing the page-builder plugin", () => {
  it("registers class-usage maintenance on the after-phases", () => {
    const { ctx, registered } = initContext();

    // The plugin's own init, run the way a host runs it.
    (pageBuilder().init as (c: unknown) => void)(ctx);

    expect(registered).toContain("afterCreate:*");
    expect(registered).toContain("afterUpdate:*");
  });

  it("contributes the index table it maintains", () => {
    // The pair matters: a table with no maintenance silently records nothing,
    // and maintenance with no table fails every write it is called for. A host
    // installing the plugin is asking for both.
    const slugs = (pageBuilder().contributes?.collections ?? []).map(
      collection => (collection as { slug?: string }).slug
    );

    expect(slugs).toContain("nx_pb_class_usage");
  });
});

describe("an integrator who renamed the index collection", () => {
  it("recognises the RENAMED collection as its own, not the declared slug", async () => {
    // `.rename()` makes the schema create only the renamed collection. A hook
    // holding the literal would write every row to a table that does not
    // exist — and would not recognise its own writes, so the first maintained
    // save would recurse: every row it inserts is a create on that collection,
    // which fires this same handler.
    //
    // Observed through the recursion guard rather than by reading the fixture
    // back: the guard is the one place the resolved slug is visible from
    // outside, and a test that asserted `ctx.self` would only be asserting its
    // own input.
    const { ctx, handlers } = initContext({
      nx_pb_class_usage: "custom_usage",
    });
    (pageBuilder().init as (c: unknown) => void)(ctx);

    const getCollection = ctx.services.collections.getCollection;

    // A write to the RENAMED index must be skipped as its own.
    await handlers[0]?.({
      collection: "custom_usage",
      data: { id: "r1" },
      req: { nextly: {} },
    });
    expect(getCollection).not.toHaveBeenCalled();

    // A write to the DECLARED slug is now an ordinary collection, and is not
    // skipped — which is what proves the guard moved rather than widened.
    await handlers[0]?.({
      collection: "nx_pb_class_usage",
      data: { id: "r1" },
      req: { nextly: {} },
    });
    expect(getCollection).toHaveBeenCalled();
  });
});

describe("the document limits maintenance derives under", () => {
  /** A document with two nodes, each applying one class. */
  const twoNodes = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      { id: "a", type: "core/text", version: 1, props: {}, classes: ["one"] },
      { id: "b", type: "core/text", version: 1, props: {}, classes: ["two"] },
    ],
  };

  /** Drive one save through the plugin's own wiring and collect index writes. */
  async function savedUnder(options: Parameters<typeof pageBuilder>[0]) {
    const { ctx, handlers } = initContext();
    const created: string[] = [];
    ctx.services.collections.getCollection = (async () => ({
      fields: [{ type: "blocks", name: "content" }],
    })) as never;

    (pageBuilder(options).init as (c: unknown) => void)(ctx);

    await handlers[0]?.({
      collection: "pages",
      data: { id: "p1" },
      req: {
        nextly: {
          // Both read shapes, so this test does not depend on which one the
          // reader currently uses: the document read moves from `findByID` to
          // `find` with a lifecycle filter in a parallel change, and this
          // assertion is about LIMITS either way.
          findByID: async () => ({ id: "p1", content: twoNodes }),
          find: async (a: { collection: string }) =>
            a.collection === "pages"
              ? {
                  items: [{ id: "p1", content: twoNodes }],
                  meta: { hasNext: false },
                }
              : { items: [], meta: { hasNext: false } },
          create: async (a: { data: { classId: string } }) => {
            created.push(a.data.classId);
            return {};
          },
          delete: async () => ({}),
        },
      },
    });
    return created;
  }

  it("uses the limits the HOST configured, not the engine defaults", async () => {
    // A host that lowers `maxNodes` is telling the renderer to draw fewer
    // nodes. Deriving the index under the defaults would record classes on
    // nodes the page never draws; deriving under RAISED limits is the
    // dangerous direction and the same defect mirrored — a class the page does
    // render would be missing, and read as unused.
    //
    // Observed through the undetermined marker, which is what a document that
    // could not be read whole contributes.
    const created = await savedUnder({
      limits: { maxDepth: 1, maxNodes: 1, maxBytes: 100_000 },
    });

    expect(created).toEqual([UNDETERMINED_CLASS_ID]);
  });

  it("records the real classes when the host configures nothing", async () => {
    // The control: without it, a wiring that always produced the marker would
    // satisfy the case above.
    const created = await savedUnder({});

    expect(created).toEqual(["one", "two"]);
  });
});
