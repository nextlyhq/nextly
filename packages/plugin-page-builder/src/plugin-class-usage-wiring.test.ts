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

import { CLASS_USAGE_INDEX_SLUG } from "./collections/class-usage-index";
import { COMPONENT_USAGE_INDEX_SLUG } from "./collections/component-usage-index";

import { UNDETERMINED_CLASS_ID } from "./class-usage-reconcile";
import { pageBuilder } from "./plugin";

/** The parts of a plugin context `init` reaches for, and nothing more. */
function initContext(renameMap: Record<string, string> = {}) {
  const registered: string[] = [];
  const handlers: ((c: Record<string, unknown>) => unknown)[] = [];
  const byKey = new Map<string, ((c: Record<string, unknown>) => unknown)[]>();
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
        // Keyed by what it was registered FOR. Selecting by position couples
        // every test to registration ORDER, so a hook added anywhere in `init`
        // silently hands them a different handler than the one they name — and
        // the failure reads as the maintenance being broken.
        const key = `${type}:${collection}`;
        byKey.set(key, [...(byKey.get(key) ?? []), handler]);
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
  /**
   * The class-usage handler for one phase, selected by what it was registered
   * FOR rather than by its position among every registration.
   *
   * More than one thing listens on `afterCreate:*` — the readiness notice does
   * too — so this takes the FIRST for the key, which is the maintenance. That
   * is the same handler the tests always ran; what changed is that a hook
   * added elsewhere in `init` no longer shifts it, and the failure no longer
   * reads as the maintenance being broken.
   *
   * Running every handler for the key was tried and is worse here: the other
   * listener reaches `getCollection`, which is exactly the call one of these
   * tests asserts is NOT made.
   */
  const maintenanceFor = (type: string, collection: string) => {
    const found = byKey.get(`${type}:${collection}`) ?? [];
    if (found.length === 0) {
      throw new Error(`nothing is registered for ${type}:${collection}`);
    }
    return found[0];
  };

  return { ctx, registered, handlers, maintenanceFor };
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
    const { ctx, maintenanceFor } = initContext({
      nx_pb_class_usage: "custom_usage",
    });
    (pageBuilder().init as (c: unknown) => void)(ctx);

    const getCollection = ctx.services.collections.getCollection;

    // A write to the RENAMED index must be skipped as its own.
    await maintenanceFor(
      "afterCreate",
      "*"
    )({
      collection: "custom_usage",
      data: { id: "r1" },
      req: { nextly: {} },
    });
    expect(getCollection).not.toHaveBeenCalled();

    // A write to the DECLARED slug is now an ordinary collection, and is not
    // skipped — which is what proves the guard moved rather than widened.
    await maintenanceFor(
      "afterCreate",
      "*"
    )({
      collection: "nx_pb_class_usage",
      data: { id: "r1" },
      req: { nextly: {} },
    });
    expect(getCollection).toHaveBeenCalled();
  });
});

describe("what one save derives, and writes to each index", () => {
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
  async function savedUnder(
    options: Parameters<typeof pageBuilder>[0],
    document: unknown = twoNodes
  ) {
    // `maintenanceFor` rather than a positional handler: the phase and
    // collection are what identify a handler, and selecting by position made
    // adding any registration silently point this at a different one.
    const { ctx, maintenanceFor } = initContext();
    const created: string[] = [];
    const componentRows: { kind?: string; componentId?: string }[] = [];
    ctx.services.collections.getCollection = (async () => ({
      fields: [{ type: "blocks", name: "content" }],
    })) as never;

    (pageBuilder(options).init as (c: unknown) => void)(ctx);

    await maintenanceFor(
      "afterCreate",
      "*"
    )({
      collection: "pages",
      data: { id: "p1" },
      req: {
        nextly: {
          // Both read shapes, so this test does not depend on which one the
          // reader currently uses: the document read moves from `findByID` to
          // `find` with a lifecycle filter in a parallel change, and this
          // assertion is about LIMITS either way.
          findByID: async () => ({ id: "p1", content: document }),
          find: async (a: { collection: string }) =>
            a.collection === "pages"
              ? {
                  items: [{ id: "p1", content: document }],
                  meta: { hasNext: false },
                }
              : { items: [], meta: { hasNext: false } },
          // Scoped to the CLASS index. One save now maintains both indexes
          // from one read, so an unscoped collector also catches the component
          // index's row — whose `classId` is `undefined`, which reads as this
          // wiring having produced a second, malformed class row. This test is
          // about the limits the CLASS derivation runs under; the component
          // index has its own.
          create: async (a: {
            collection: string;
            data: { classId?: string };
          }) => {
            if (a.collection === CLASS_USAGE_INDEX_SLUG) {
              created.push(a.data.classId as string);
            }
            if (a.collection === COMPONENT_USAGE_INDEX_SLUG) {
              componentRows.push({
                kind: (a.data as { kind?: string }).kind,
                componentId: (a.data as { componentId?: string }).componentId,
              });
            }
            return {};
          },
          delete: async () => ({}),
        },
      },
    });
    return { created, componentRows };
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
    const { created } = await savedUnder({
      limits: { maxDepth: 1, maxNodes: 1, maxBytes: 100_000 },
    });

    expect(created).toEqual([UNDETERMINED_CLASS_ID]);
  });

  it("records the real classes when the host configures nothing", async () => {
    // The control: without it, a wiring that always produced the marker would
    // satisfy the case above.
    const { created } = await savedUnder({});

    expect(created).toEqual(["one", "two"]);
  });

  describe("the component index, maintained from the same read", () => {
    const withInstance = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        { id: "a", type: "core/text", version: 1, props: {}, classes: ["one"] },
        {
          id: "i1",
          type: "nextly/component-instance",
          version: 1,
          props: { componentId: "header" },
        },
      ],
    };

    it("writes a row for a component the saved page embeds", async () => {
      // The feature's own evidence. The class assertions above pass whether or
      // not a second index exists, so without this the wiring could maintain
      // nothing and every other test in the file would stay green.
      const { componentRows } = await savedUnder({}, withInstance);

      expect(componentRows).toEqual([
        { kind: "reference", componentId: "header" },
      ]);
    });

    it("writes NO component row for a page that embeds none", async () => {
      // The control. Without it, a wiring that wrote a row unconditionally —
      // recording a reference no document holds — would satisfy the case above.
      const { componentRows } = await savedUnder({});

      expect(componentRows).toEqual([]);
    });

    it("marks a page it could not read whole, rather than calling it empty", async () => {
      // A cap of one node stops the walk before the instance. The row that
      // records THAT is what stops "could not read" being stored as "references
      // nothing" — the answer that would let the component be deleted.
      const { componentRows } = await savedUnder(
        { limits: { maxDepth: 1, maxNodes: 1, maxBytes: 100_000 } },
        withInstance
      );

      expect(componentRows).toEqual([{ kind: "unreadable", componentId: "" }]);
    });
  });
});
