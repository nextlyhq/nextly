/**
 * Retiring a component's removed fields at publish, and stripping their values
 * on every write.
 *
 * Driven through the handlers the registration wires, with a store that keeps
 * its rows in memory, so each case asserts what a write stores and what the
 * store records rather than how the hooks get there.
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  type RetiredExposures,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it, vi } from "vitest";

import { registerRetiredExposures } from "./retired-exposure-hooks";
import type { ComponentHistory } from "./retired-history";
import type { RetiredPins } from "./retired-pins";
import type { RetiredStore } from "./retired-store";

type Row = Record<string, unknown>;
type Handler = (context: unknown) => unknown;

const COMPONENTS = "nx_pb_components";
const LIMITS = { maxDepth: 12, maxNodes: 5000, maxBytes: 2_097_152 };

const heading = (id: string): Row => ({
  id,
  type: "core/heading",
  version: 1,
  props: { text: id, level: 2 },
});

const placing = (
  id: string,
  componentId: string,
  overrides?: Row,
  slots?: Row
): Row => ({
  id,
  type: COMPONENT_INSTANCE_TYPE,
  version: 1,
  props: { componentId, ...(overrides === undefined ? {} : { overrides }) },
  ...(slots === undefined ? {} : { slots }),
});

const box = (id: string, children: Row[]): Row => ({
  id,
  type: "core/box",
  version: 1,
  props: {},
  slots: { children },
});

const page = (nodes: Row[]): Row => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes,
});

/** A definition exposing these fields and slots, with optional variants. */
const definition = (
  fields: string[],
  slots: string[] = [],
  variants?: Row
): Row => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "component",
  nodes: [heading("h"), box("b", [])],
  exposed: fields.map(id => ({
    id,
    label: id,
    nodeId: "h",
    propPath: "text",
    type: "text",
  })),
  ...(slots.length === 0
    ? {}
    : {
        slots: Object.fromEntries(
          slots.map(id => [id, { label: id, nodeId: "b", slot: "children" }])
        ),
      }),
  ...(variants === undefined ? {} : { variants }),
});

/** A store over an in-memory map, recording each retirement it is asked for. */
function memoryStore(initial: Record<string, RetiredExposures> = {}) {
  const held = new Map(Object.entries(initial));
  const retired: { componentId: string; retired: RetiredExposures }[] = [];
  const reads: string[][] = [];
  const store: RetiredStore = {
    of: async ids => {
      reads.push([...ids]);
      return new Map(
        ids.flatMap(id => {
          const entry = held.get(id);
          return entry === undefined ? [] : [[id, entry] as const];
        })
      );
    },
    retire: async (componentId, ids) => {
      retired.push({ componentId, retired: ids });
    },
  };
  return { store, retired, reads };
}

/** The registration's handlers, by phase and collection. */
function harness(
  options: {
    store?: RetiredStore;
    componentStoreLocalized?: boolean;
    /** Whether the component store owns the Draft/Published lifecycle. */
    componentStoreStatus?: boolean;
    singles?: Record<string, Row[]>;
    collections?: Record<string, Row[]>;
    /** The component's published definitions, oldest first. */
    history?: Row[];
    /** A history read in place of `history`'s. */
    versions?: ComponentHistory;
    pins?: RetiredPins;
  } = {}
) {
  const handlers = new Map<string, Handler>();
  const errors: { message: string; meta?: Row }[] = [];
  const warnings: { message: string; meta?: Row }[] = [];
  const registryReads: string[] = [];
  const { store } = options.store ? { store: options.store } : memoryStore();
  registerRetiredExposures({
    ctx: {
      hooks: {
        on: (type, collection, handler) => {
          handlers.set(`${type} ${collection}`, handler as Handler);
        },
      },
      services: {
        collections: {
          getCollection: async name => {
            registryReads.push(name);
            if (name === COMPONENTS) {
              return {
                status: options.componentStoreStatus !== false,
                localized: options.componentStoreLocalized === true,
                fields: [{ name: "content", type: "blocks" }],
              };
            }
            return {
              status: true,
              fields: options.collections?.[name] ?? [
                { name: "content", type: "blocks" },
                { name: "settings", type: "json" },
              ],
            };
          },
        },
        singles: {
          list: async ({ slugAllowlist }) => ({
            data: slugAllowlist.flatMap(slug =>
              options.singles?.[slug] === undefined
                ? []
                : [{ slug, fields: options.singles[slug] }]
            ),
          }),
        },
        versions: options.versions ?? publishedHistory(options.history ?? []),
      },
      logger: {
        warn: (message, meta) => warnings.push({ message, meta }),
        error: (message, meta) => errors.push({ message, meta }),
      },
    },
    componentCollection: COMPONENTS,
    componentField: "content",
    store,
    limits: () => LIMITS,
    ...(options.pins === undefined ? {} : { pins: options.pins }),
    commitWait: async () => {},
  });
  const run = (phase: string, collection: string, context: Row) =>
    handlers.get(`${phase} ${collection}`)!({
      collection: COMPONENTS,
      ...context,
    });
  return { handlers, run, errors, warnings, registryReads };
}

/** A history of published definitions, given oldest first. */
function publishedHistory(definitions: Row[]): ComponentHistory {
  return {
    list: async (_ref, { limit, cursor }) =>
      definitions
        .map((_, index) => ({ versionNo: index + 1, status: "published" }))
        .reverse()
        .filter(row => cursor === undefined || row.versionNo < cursor)
        .slice(0, limit),
    get: async (_ref, versionNo) => ({
      snapshot: { id: "hero", content: definitions[versionNo - 1] },
    }),
  };
}

describe("recording retired ids at publish", () => {
  const published = (before: Row, after: Row, extra: Row = {}): Row => ({
    operation: "update",
    originalData: { id: "hero", status: "published", content: before },
    data: { id: "hero", status: "published", content: after, ...extra },
  });

  it("retires the fields and slots the published definition dropped", async () => {
    const { store, retired } = memoryStore();
    const { run } = harness({ store });

    await run(
      "afterUpdate",
      COMPONENTS,
      published(
        definition(["title", "body"], ["aside", "main"]),
        definition(["body"], ["main"])
      )
    );

    expect(retired).toEqual([
      {
        componentId: "hero",
        retired: { properties: ["title"], slots: ["aside"] },
      },
    ]);
  });

  it("reads definitions stored as JSON text", async () => {
    const { store, retired } = memoryStore();
    const { run } = harness({ store });

    await run(
      "afterUpdate",
      COMPONENTS,
      published(
        JSON.stringify(definition(["title", "body"])) as never,
        JSON.stringify(definition(["body"])) as never
      )
    );

    expect(retired).toEqual([
      { componentId: "hero", retired: { properties: ["title"], slots: [] } },
    ]);
  });

  it("retires nothing on a working-draft save, and reads nothing first", async () => {
    const { store, retired } = memoryStore();
    const { run, registryReads } = harness({ store });

    await run(
      "afterUpdate",
      COMPONENTS,
      published(definition(["title"]), definition([]), {
        _isWorkingDraft: true,
      })
    );

    expect(retired).toEqual([]);
    // A draft saved inside a caller's transaction reaches this hook too, and
    // a registry read on the pool there could wait on that transaction.
    expect(registryReads).toEqual([]);
  });

  it("retires nothing when the write leaves the component a draft", async () => {
    const { store, retired } = memoryStore();
    const { run } = harness({ store });

    await run("afterUpdate", COMPONENTS, {
      originalData: {
        id: "hero",
        status: "published",
        content: definition(["title"]),
      },
      data: { id: "hero", status: "draft", content: definition([]) },
    });

    expect(retired).toEqual([]);
  });

  it("retires nothing for an unchanged definition, as a held edit reported with the live row", async () => {
    const { store, retired } = memoryStore();
    const { run } = harness({ store });

    await run(
      "afterUpdate",
      COMPONENTS,
      published(
        definition(["title"], ["aside"]),
        definition(["title"], ["aside"])
      )
    );

    expect(retired).toEqual([]);
  });

  it("retires nothing, and reports nothing, when the new definition cannot be read", async () => {
    const { store, retired } = memoryStore();
    const { run, errors } = harness({ store });

    await run(
      "afterUpdate",
      COMPONENTS,
      published(definition(["title"]), "{not json" as never)
    );

    expect(retired).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("retires on any update of a store with no publishing lifecycle", async () => {
    const { store, retired } = memoryStore();
    const { run } = harness({ store, componentStoreStatus: false });

    await run("afterUpdate", COMPONENTS, {
      originalData: { id: "hero", content: definition(["title", "body"]) },
      data: { id: "hero", content: definition(["body"]) },
    });

    expect(retired).toEqual([
      { componentId: "hero", retired: { properties: ["title"], slots: [] } },
    ]);
  });

  it("retires nothing in a localized store, and warns naming the component", async () => {
    const { store, retired } = memoryStore();
    const { run, warnings } = harness({ store, componentStoreLocalized: true });

    await run(
      "afterUpdate",
      COMPONENTS,
      published(definition(["title", "body"]), definition(["body"]))
    );

    expect(retired).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('"hero"');
    expect(warnings[0].meta).toMatchObject({
      retired: { properties: ["title"], slots: [] },
    });
  });

  it("says nothing about a localized store's write that drops no field", async () => {
    const { store } = memoryStore();
    const { run, warnings } = harness({ store, componentStoreLocalized: true });

    await run(
      "afterUpdate",
      COMPONENTS,
      published(definition(["title"]), definition(["title"]))
    );

    expect(warnings).toEqual([]);
  });

  it("logs a failed record naming the component, and does not throw", async () => {
    const { store } = memoryStore();
    const failing: RetiredStore = {
      ...store,
      retire: async () => {
        throw new Error("database down");
      },
    };
    const { run, errors } = harness({ store: failing });

    await expect(
      run(
        "afterUpdate",
        COMPONENTS,
        published(definition(["title"]), definition([]))
      )
    ).resolves.toBeUndefined();

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('"hero"');
    expect(errors[0].meta).toMatchObject({
      componentId: "hero",
      retired: { properties: ["title"], slots: [] },
    });
  });

  /**
   * Pins that record what they are asked to do. `shows` answers, look by
   * look, whether the removal is in history yet; true from then on.
   */
  function recordingPins(
    shows: (boolean | "fails")[] = [],
    newest: () => Promise<number> = async () => 7
  ) {
    const calls: string[] = [];
    let looks = 0;
    const pins: RetiredPins = {
      hold: async (componentId, dropped, lifecycle, newerThan) => {
        calls.push(
          `hold ${componentId} ${dropped.properties.join(",")} ${lifecycle}` +
            (newerThan === undefined ? "" : ` >${newerThan}`)
        );
        const shown = shows[looks] ?? true;
        looks += 1;
        if (shown === "fails") throw new Error("database down");
        return shown;
      },
      newestVersion: newest,
      release: async componentId => {
        calls.push(`release ${componentId}`);
      },
    };
    return { pins, calls };
  }

  it("holds the removal's versions when the record and its repair both fail", async () => {
    const { pins, calls } = recordingPins();
    const failing: RetiredStore = {
      of: async () => new Map(),
      retire: async () => {
        throw new Error("database down");
      },
    };
    const { run } = harness({
      store: failing,
      pins,
      history: [definition(["title", "body"]), definition(["body"])],
    });

    await run(
      "afterUpdate",
      COMPONENTS,
      published(definition(["title", "body"]), definition(["body"]))
    );

    expect(calls).toEqual(["hold hero title true"]);
  });

  it("releases the held versions once the repair records the ids", async () => {
    const { pins, calls } = recordingPins();
    const { store } = memoryStore();
    let attempts = 0;
    const failingOnce: RetiredStore = {
      ...store,
      retire: async (componentId, ids) => {
        attempts += 1;
        if (attempts === 1) throw new Error("database down");
        await store.retire(componentId, ids);
      },
    };
    const { run } = harness({
      store: failingOnce,
      pins,
      history: [definition(["title", "body"]), definition(["body"])],
    });

    await run(
      "afterUpdate",
      COMPONENTS,
      published(definition(["title", "body"]), definition(["body"]))
    );

    expect(calls).toEqual(["hold hero title true", "release hero"]);
  });

  it("holds nothing when the record succeeds", async () => {
    const { pins, calls } = recordingPins();
    const { run } = harness({ pins });

    await run(
      "afterUpdate",
      COMPONENTS,
      published(definition(["title", "body"]), definition(["body"]))
    );

    expect(calls).toEqual([]);
  });

  it("holds a removal made in a caller's transaction once it commits", async () => {
    const { pins, calls } = recordingPins([false, false, true]);
    const failing: RetiredStore = {
      of: async () => new Map(),
      retire: async () => {
        throw new Error("database down");
      },
    };
    const { run } = harness({ store: failing, pins });

    await run("afterUpdate", COMPONENTS, {
      ...published(definition(["title"]), definition([])),
      executor: {},
    });

    await vi.waitFor(() => expect(calls).toHaveLength(3));
    // Only a removal newer than what history showed before the commit.
    expect(new Set(calls)).toEqual(new Set(["hold hero title true >7"]));
  });

  it("holds at every look, then repairs, when history before the commit cannot be read", async () => {
    const { pins, calls } = recordingPins([], async () => {
      throw new Error("database down");
    });
    const failing: RetiredStore = {
      of: async () => new Map(),
      retire: async () => {
        throw new Error("database down");
      },
    };
    const { run } = harness({
      store: failing,
      pins,
      history: [definition(["title"]), definition([])],
    });

    await run("afterUpdate", COMPONENTS, {
      ...published(definition(["title"]), definition([])),
      executor: {},
    });

    // A found removal does not end the wait: it may be an earlier one.
    await vi.waitFor(() => expect(calls).toHaveLength(70));
    expect(new Set(calls)).toEqual(new Set(["hold hero title true >0"]));
  });

  it("keeps looking after a look that fails", async () => {
    const { pins, calls } = recordingPins(["fails", true]);
    const failing: RetiredStore = {
      of: async () => new Map(),
      retire: async () => {
        throw new Error("database down");
      },
    };
    const { run, errors } = harness({ store: failing, pins });

    await run("afterUpdate", COMPONENTS, {
      ...published(definition(["title"]), definition([])),
      executor: {},
    });

    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(
      errors.some(error => error.message.includes("looked for again"))
    ).toBe(true);
  });

  it("holds nothing for a transaction's removal that never shows, and says so", async () => {
    const { pins, calls } = recordingPins(
      Array.from({ length: 70 }, () => false)
    );
    const failing: RetiredStore = {
      of: async () => new Map(),
      retire: async () => {
        throw new Error("database down");
      },
    };
    const { run, warnings } = harness({ store: failing, pins });

    await run("afterUpdate", COMPONENTS, {
      ...published(definition(["title"]), definition([])),
      executor: {},
    });

    await vi.waitFor(() =>
      expect(
        warnings.some(warning => warning.message.includes("never showed"))
      ).toBe(true)
    );
    expect(calls).toHaveLength(70);
  });

  it("releases nothing from inside a caller's transaction", async () => {
    const { pins, calls } = recordingPins();
    const { run } = harness({
      pins,
      history: [definition(["title", "body"]), definition(["body"])],
    });

    await run("beforeUpdate", "*", {
      collection: COMPONENTS,
      operation: "update",
      originalData: { id: "hero", content: definition(["body"]) },
      data: { content: definition(["body"]) },
      executor: {},
    });
    await run("beforeUpdate", "*", {
      collection: COMPONENTS,
      operation: "update",
      originalData: { id: "hero", content: definition(["body"]) },
      data: { content: definition(["body"]) },
    });

    // Only the write outside a transaction released.
    expect(calls).toEqual(["release hero"]);
  });

  it("repairs a failed record from the component's history", async () => {
    const { store, retired } = memoryStore();
    let attempts = 0;
    const failingOnce: RetiredStore = {
      ...store,
      retire: async (componentId, ids) => {
        attempts += 1;
        if (attempts === 1) throw new Error("database down");
        await store.retire(componentId, ids);
      },
    };
    const { run, errors } = harness({
      store: failingOnce,
      history: [definition(["title", "body"]), definition(["body"])],
    });

    await run(
      "afterUpdate",
      COMPONENTS,
      published(definition(["title", "body"]), definition(["body"]))
    );

    expect(errors).toHaveLength(1);
    expect(retired).toEqual([
      { componentId: "hero", retired: { properties: ["title"], slots: [] } },
    ]);
  });

  it("does not repair in a localized store, which records no retirements", async () => {
    const { store, retired, reads } = memoryStore();
    const { run } = harness({
      store,
      componentStoreLocalized: true,
      history: [definition(["title"]), definition([])],
    });

    await run(
      "afterUpdate",
      COMPONENTS,
      published(definition(["title"]), definition([]))
    );

    expect(retired).toEqual([]);
    expect(reads).toEqual([]);
  });

  it("logs a repair that fails too, and does not throw", async () => {
    const failing: RetiredStore = {
      of: async () => {
        throw new Error("database down");
      },
      retire: async () => {
        throw new Error("database down");
      },
    };
    const { run, errors } = harness({
      store: failing,
      history: [definition(["title"]), definition([])],
    });

    await expect(
      run(
        "afterUpdate",
        COMPONENTS,
        published(definition(["title"]), definition([]))
      )
    ).resolves.toBeUndefined();

    expect(errors).toHaveLength(2);
    expect(errors[1]!.message).toContain('"hero"');
  });
});

describe("stripping retired values on every write", () => {
  const retiredHero = () =>
    memoryStore({ hero: { properties: ["title"], slots: ["aside"] } });

  it("strips a page's placements, nested ones too, keeping live values", async () => {
    const { store } = retiredHero();
    const { run } = harness({ store });

    const written = (await run("beforeUpdate", "*", {
      collection: "pages",
      data: {
        title: "Home",
        content: page([
          placing("i1", "hero", { title: "old", body: "kept" }),
          box("b1", [
            placing("i2", "card", undefined, {
              body: [placing("i3", "hero", { title: "deep" })],
            }),
          ]),
          placing("i4", "hero", undefined, {
            aside: [heading("gone")],
            main: [heading("kept")],
          }),
        ]),
      },
    })) as Row;

    const nodes = (written.content as { nodes: Row[] }).nodes;
    expect((nodes[0].props as Row).overrides).toEqual({ body: "kept" });
    const nested = (
      (nodes[1].slots as { children: Row[] }).children[0].slots as {
        body: Row[];
      }
    ).body[0];
    expect((nested.props as Row).overrides).toBeUndefined();
    expect(nodes[2].slots).toEqual({ main: [heading("kept")] });
    expect(written.title).toBe("Home");
  });

  it("strips a Single's blocks field, read from the Singles registry", async () => {
    const { store } = retiredHero();
    const { run, registryReads } = harness({
      store,
      singles: { homepage: [{ name: "layout", type: "blocks" }] },
    });

    const written = (await run("beforeUpdate", "*", {
      collection: "single:homepage",
      data: { layout: page([placing("i1", "hero", { title: "old" })]) },
    })) as Row;

    const nodes = (written.layout as { nodes: Row[] }).nodes;
    expect((nodes[0].props as Row).overrides).toBeUndefined();
    expect(registryReads).toEqual([]);
  });

  it("strips inside a caller's transaction", async () => {
    const { store } = retiredHero();
    const { run } = harness({ store });

    const written = (await run("beforeCreate", "*", {
      collection: "pages",
      executor: {},
      data: { content: page([placing("i1", "hero", { title: "old" })]) },
    })) as Row;

    expect(
      ((written.content as { nodes: Row[] }).nodes[0].props as Row).overrides
    ).toBeUndefined();
  });

  it("keeps a value written as JSON text as text", async () => {
    const { store } = retiredHero();
    const { run } = harness({ store });

    const written = (await run("beforeUpdate", "*", {
      collection: "pages",
      data: {
        content: JSON.stringify(
          page([placing("i1", "hero", { title: "old", body: "kept" })])
        ),
      },
    })) as Row;

    expect(typeof written.content).toBe("string");
    const nodes = (JSON.parse(written.content as string) as { nodes: Row[] })
      .nodes;
    expect((nodes[0].props as Row).overrides).toEqual({ body: "kept" });
  });

  it("strips a blocks field inside named groups, leaving the rest of each group as written", async () => {
    const { store } = retiredHero();
    const { run } = harness({
      store,
      collections: {
        pages: [
          {
            name: "hero",
            type: "group",
            fields: [
              { name: "heading", type: "text" },
              {
                name: "inner",
                type: "group",
                fields: [{ name: "body", type: "blocks" }],
              },
            ],
          },
        ],
      },
    });
    const data = {
      hero: {
        heading: "Hi",
        inner: {
          body: page([placing("i1", "hero", { title: "old", body: "kept" })]),
        },
      },
    };

    const written = (await run("beforeUpdate", "*", {
      collection: "pages",
      data,
    })) as Row;

    const hero = written.hero as { heading: string; inner: { body: Row } };
    expect(hero.heading).toBe("Hi");
    const nodes = (hero.inner.body as { nodes: Row[] }).nodes;
    expect((nodes[0].props as Row).overrides).toEqual({ body: "kept" });
    // The write's own objects are left as they came.
    expect(
      ((data.hero.inner.body as { nodes: Row[] }).nodes[0].props as Row)
        .overrides
    ).toEqual({ title: "old", body: "kept" });
  });

  it("leaves a document under a group the declaration does not name", async () => {
    const { store } = retiredHero();
    const { run } = harness({
      store,
      collections: { pages: [{ name: "settings", type: "json" }] },
    });

    const written = await run("beforeUpdate", "*", {
      collection: "pages",
      data: {
        settings: { body: page([placing("i1", "hero", { title: "kept" })]) },
      },
    });

    expect(written).toBeUndefined();
  });

  it("leaves a write with nothing retired as it came", async () => {
    const { store } = memoryStore({
      other: { properties: ["title"], slots: [] },
    });
    const { run } = harness({ store });

    const written = await run("beforeUpdate", "*", {
      collection: "pages",
      data: { content: page([placing("i1", "hero", { title: "live" })]) },
    });

    expect(written).toBeUndefined();
  });

  it("leaves a document-shaped value in a field that is not a blocks field", async () => {
    const { store } = retiredHero();
    const { run } = harness({ store });

    const written = await run("beforeUpdate", "*", {
      collection: "pages",
      data: { settings: page([placing("i1", "hero", { title: "kept" })]) },
    });

    expect(written).toBeUndefined();
  });

  it("reads no configuration for a write carrying no document", async () => {
    const { store, reads } = retiredHero();
    const { run, registryReads } = harness({ store });

    await run("beforeUpdate", "*", {
      collection: "pages",
      data: { title: "Home" },
    });

    expect(registryReads).toEqual([]);
    expect(reads).toEqual([]);
  });

  it("lets the write through and logs when the store cannot be read", async () => {
    const { store } = retiredHero();
    const failing: RetiredStore = {
      ...store,
      of: async () => {
        throw new Error("database down");
      },
    };
    const { run, errors } = harness({ store: failing });

    const written = await run("beforeUpdate", "*", {
      collection: "pages",
      data: { content: page([placing("i1", "hero", { title: "old" })]) },
    });

    expect(written).toBeUndefined();
    expect(errors).toHaveLength(1);
    expect(errors[0].meta).toMatchObject({ collection: "pages" });
  });
});

describe("a component dropping its own retired ids", () => {
  it("drops an id its history retired when the table lost the record", async () => {
    const { store, retired } = memoryStore();
    const { run } = harness({
      store,
      history: [definition(["title", "body"]), definition(["body"])],
    });

    const result = (await run("beforeUpdate", "*", {
      collection: COMPONENTS,
      operation: "update",
      originalData: { id: "hero", content: definition(["body"]) },
      data: { content: definition(["title", "body"]), status: "published" },
    })) as Row;

    expect(
      (result.content as { exposed: { id: string }[] }).exposed.map(
        entry => entry.id
      )
    ).toEqual(["body"]);
    expect(retired).toEqual([
      { componentId: "hero", retired: { properties: ["title"], slots: [] } },
    ]);
  });

  it("keeps a component write going when its history cannot be read", async () => {
    const { store } = memoryStore({
      hero: { properties: ["title"], slots: [] },
    });
    const { run, errors } = harness({
      store,
      versions: {
        list: async () => {
          throw new Error("database down");
        },
        get: async () => ({ snapshot: null }),
      },
    });

    const result = (await run("beforeUpdate", "*", {
      collection: COMPONENTS,
      operation: "update",
      originalData: { id: "hero", content: definition(["body"]) },
      data: { content: definition(["title", "body"]) },
    })) as Row;

    expect(
      (result.content as { exposed: { id: string }[] }).exposed.map(
        entry => entry.id
      )
    ).toEqual(["body"]);
    expect(errors.some(error => error.message.includes('"hero"'))).toBe(true);
  });

  it("drops them from exposed, slots and variants, keeping an emptied variant", async () => {
    const { store } = memoryStore({
      hero: { properties: ["title"], slots: ["aside"] },
    });
    const { run } = harness({ store });

    const restored = definition(["title", "body"], ["aside"], {
      bold: { label: "Bold", overrides: { title: "Big", body: "Strong" } },
      quiet: { label: "Quiet", overrides: { title: "small" } },
    });
    const written = (await run("beforeUpdate", "*", {
      collection: COMPONENTS,
      originalData: { id: "hero" },
      data: { content: restored },
    })) as Row;

    const content = written.content as Row;
    expect((content.exposed as Row[]).map(entry => entry.id)).toEqual(["body"]);
    expect(content.slots).toBeUndefined();
    expect(content.variants).toEqual({
      bold: { label: "Bold", overrides: { body: "Strong" } },
      quiet: { label: "Quiet", overrides: {} },
    });
    // The value written is never changed in place.
    expect((restored.exposed as Row[]).map(entry => entry.id)).toEqual([
      "title",
      "body",
    ]);
  });

  it("drops a retired field when that is all the definition holds of it", async () => {
    const { store } = memoryStore({
      hero: { properties: ["title"], slots: [] },
    });
    const { run } = harness({ store });

    const written = (await run("beforeUpdate", "*", {
      collection: COMPONENTS,
      originalData: { id: "hero" },
      data: { content: definition(["title", "body"]) },
    })) as Row;

    expect(
      ((written.content as Row).exposed as Row[]).map(entry => entry.id)
    ).toEqual(["body"]);
  });

  it("leaves another component's definition holding the same ids", async () => {
    const { store } = memoryStore({
      hero: { properties: ["title"], slots: [] },
    });
    const { run } = harness({ store });

    const written = await run("beforeUpdate", "*", {
      collection: COMPONENTS,
      originalData: { id: "card" },
      data: { content: definition(["title"]) },
    });

    expect(written).toBeUndefined();
  });
});
