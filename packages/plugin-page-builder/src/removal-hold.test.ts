/**
 * A removal's hold: the store over the bookkeeping table, the fence that
 * refuses a write newly setting a held field, and the release once the
 * component is published. The table and real writes are proved on every
 * dialect in `__tests__/removal-hold.integration.test.ts`.
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
} from "@nextlyhq/blocks-engine";
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import {
  FIELD_BEING_REMOVED,
  registerHoldRelease,
  registerRemovalFence,
  removalHoldStore,
  REMOVAL_HOLD,
  type HoldDirectApi,
  type RemovalHold,
} from "./removal-hold";

type Row = Record<string, unknown>;
type Handler = (context: unknown) => unknown;

const LIMITS = { maxDepth: 12, maxNodes: 5000, maxBytes: 2_097_152 };
const TABLE = "nx_pb_component_retired";

const placing = (id: string, componentId: string, overrides?: Row): Row => ({
  id,
  type: COMPONENT_INSTANCE_TYPE,
  version: 1,
  props: { componentId, ...(overrides === undefined ? {} : { overrides }) },
});

const page = (nodes: Row[]): Row => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes,
});

/** A Direct API over an in-memory table, as the store sees one. */
function memoryTable(rows: Row[] = []): HoldDirectApi & { rows: Row[] } {
  let next = rows.length;
  return {
    rows,
    find: async ({ where }) => {
      const filter = where as {
        componentId: { in: string[] };
        kind: { equals: string };
      };
      return {
        items: rows.filter(
          row =>
            filter.componentId.in.includes(row.componentId as string) &&
            row.kind === filter.kind.equals
        ),
        meta: { hasNext: false },
      };
    },
    create: async ({ data }) => {
      next += 1;
      rows.push({ id: String(next), ...data });
      return data;
    },
    delete: async ({ id }) => {
      const at = rows.findIndex(row => row.id === id);
      if (at >= 0) rows.splice(at, 1);
      return null;
    },
  };
}

const HELD: RemovalHold = {
  properties: ["title"],
  slots: ["aside"],
  confirmed: 2,
  until: 2_000,
};

describe("the hold store", () => {
  it("records a hold in place of the one before, and reads it back", async () => {
    const table = memoryTable();
    const store = removalHoldStore({
      nextly: async () => table,
      collection: TABLE,
      clock: () => 1_000,
    });

    await store.hold("hero", { ...HELD, confirmed: 1 });
    await store.hold("hero", HELD);

    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]!.kind).toBe(REMOVAL_HOLD);
    expect(await store.of(["hero", "card"])).toEqual(new Map([["hero", HELD]]));
  });

  it("reads a hold that has run out as none", async () => {
    const table = memoryTable();
    let now = 1_000;
    const store = removalHoldStore({
      nextly: async () => table,
      collection: TABLE,
      clock: () => now,
    });
    await store.hold("hero", HELD);

    now = 2_000;

    expect(await store.of(["hero"])).toEqual(new Map());
  });

  it("reads a row it cannot parse as holding nothing", async () => {
    const table = memoryTable([
      {
        id: "1",
        componentId: "hero",
        kind: REMOVAL_HOLD,
        exposureId: '{"properties":"title"}',
      },
    ]);
    const store = removalHoldStore({
      nextly: async () => table,
      collection: TABLE,
      clock: () => 0,
    });

    expect(await store.of(["hero"])).toEqual(new Map());
  });

  it("ends a hold", async () => {
    const table = memoryTable();
    const store = removalHoldStore({
      nextly: async () => table,
      collection: TABLE,
      clock: () => 0,
    });
    await store.hold("hero", HELD);

    await store.release("hero");

    expect(table.rows).toEqual([]);
  });
});

/** The fence's and the release's handlers, over a fixed set of holds. */
function harness(
  options: {
    holds?: Record<string, RemovalHold>;
    draft?: unknown;
    failRead?: boolean;
  } = {}
) {
  const handlers = new Map<string, Handler>();
  const errors: string[] = [];
  const released: string[] = [];
  const ctx = {
    hooks: {
      on: (type: string, collection: string, handler: Handler) => {
        handlers.set(`${type} ${collection}`, handler);
      },
    },
    logger: { error: (message: string) => errors.push(message) },
  };
  registerRemovalFence({
    ctx,
    holds: () => ({
      of: async ids => {
        if (options.failRead === true) throw new Error("database down");
        return new Map(
          ids.flatMap(id =>
            options.holds?.[id] === undefined
              ? []
              : [[id, options.holds[id]] as const]
          )
        );
      },
    }),
    storedDraft: async () => options.draft ?? null,
    limits: () => LIMITS,
    titleOf: async id => (id === "hero" ? "Hero" : undefined),
  });
  registerHoldRelease({
    ctx,
    componentCollection: "components",
    holds: () => ({
      release: async id => {
        released.push(id);
      },
    }),
  });
  const run = (phase: string, collection: string, context: Row) =>
    handlers.get(`${phase} ${collection}`)!({
      collection: "pages",
      ...context,
    });
  return { run, errors, released };
}

/** The refusal a held write throws, or `undefined` when it went through. */
async function refusal(written: Promise<unknown>): Promise<unknown> {
  try {
    await written;
    return undefined;
  } catch (error) {
    return error;
  }
}

describe("the fence while a removal is held", () => {
  it("refuses a write newly setting a held field, naming the component", async () => {
    const { run } = harness({ holds: { hero: HELD } });

    const error = await refusal(
      Promise.resolve(
        run("beforeUpdate", "*", {
          data: { content: page([placing("i1", "hero", { title: "new" })]) },
          originalData: {
            id: "p1",
            content: page([placing("i1", "hero", { body: "kept" })]),
          },
        })
      )
    );

    expect(NextlyError.isCode(error, "VALIDATION_ERROR")).toBe(true);
    const issues = (error as NextlyError).publicData as {
      errors: { path: string; code: string; message: string }[];
    };
    expect(issues.errors[0]).toMatchObject({
      path: "content",
      code: FIELD_BEING_REMOVED,
    });
    expect(issues.errors[0]!.message).toContain("Hero");
  });

  it("refuses a created document holding a held field", async () => {
    const { run } = harness({ holds: { hero: HELD } });

    const error = await refusal(
      Promise.resolve(
        run("beforeCreate", "*", {
          data: { content: page([placing("i1", "hero", undefined)]) },
        })
      )
    );
    expect(error).toBeUndefined();

    const slotted = await refusal(
      Promise.resolve(
        run("beforeCreate", "*", {
          data: {
            content: page([
              {
                ...placing("i1", "hero"),
                slots: { aside: [placing("x", "card")] },
              },
            ]),
          },
        })
      )
    );
    expect(NextlyError.isCode(slotted, "VALIDATION_ERROR")).toBe(true);
  });

  it("lets a document keep a held value it already stores, live or in its draft", async () => {
    const { run } = harness({
      holds: { hero: HELD },
      draft: { content: page([placing("i1", "hero", { title: "draft" })]) },
    });

    const kept = await refusal(
      Promise.resolve(
        run("beforeUpdate", "*", {
          data: { content: page([placing("i1", "hero", { title: "draft" })]) },
          originalData: { id: "p1", content: page([placing("i1", "hero")]) },
        })
      )
    );

    expect(kept).toBeUndefined();
  });

  it("finds a held value under a named group", async () => {
    const { run } = harness({ holds: { hero: HELD } });

    const error = await refusal(
      Promise.resolve(
        run("beforeUpdate", "*", {
          data: {
            hero: { body: page([placing("i1", "hero", { title: "new" })]) },
          },
          originalData: { id: "p1" },
        })
      )
    );

    expect(
      ((error as NextlyError).publicData as { errors: { path: string }[] })
        .errors[0]!.path
    ).toBe("hero.body");
  });

  it("lets through a write placing no held component", async () => {
    const { run } = harness({ holds: { hero: HELD } });

    expect(
      await refusal(
        Promise.resolve(
          run("beforeUpdate", "*", {
            data: {
              content: page([placing("i1", "card", { title: "fine" })]),
            },
            originalData: { id: "p1" },
          })
        )
      )
    ).toBeUndefined();
  });

  it("lets the write through, and logs, when the holds cannot be read", async () => {
    const { run, errors } = harness({ failRead: true });

    expect(
      await refusal(
        Promise.resolve(
          run("beforeUpdate", "*", {
            data: { content: page([placing("i1", "hero", { title: "x" })]) },
            originalData: { id: "p1" },
          })
        )
      )
    ).toBeUndefined();
    expect(errors).toHaveLength(1);
  });
});

describe("ending a hold", () => {
  it("ends the hold once the component is published", async () => {
    const { run, released } = harness();

    await run("afterUpdate", "components", {
      data: { id: "hero", status: "published" },
    });

    expect(released).toEqual(["hero"]);
  });

  it("keeps it through a working-draft save, a draft, and a caller's transaction", async () => {
    const { run, released } = harness();

    await run("afterUpdate", "components", {
      data: { id: "hero", status: "published", _isWorkingDraft: true },
    });
    await run("afterUpdate", "components", {
      data: { id: "hero", status: "draft" },
    });
    await run("afterUpdate", "components", {
      executor: {},
      data: { id: "hero", status: "published" },
    });

    expect(released).toEqual([]);
  });
});
