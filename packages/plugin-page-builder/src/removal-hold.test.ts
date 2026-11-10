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
  registerPublishRecount,
  registerRemovalFence,
  REMOVAL_RECOUNT,
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

/** A component definition exposing these fields. */
const definition = (fields: string[]): Row => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "component",
  nodes: [],
  exposed: fields.map(id => ({
    id,
    label: id,
    nodeId: "h",
    propPath: "text",
    type: "text",
  })),
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
  confirmedComplete: true,
  until: 2_000,
  token: "t1",
};

describe("the hold store", () => {
  const storeOver = (
    table: ReturnType<typeof memoryTable>,
    now = () => 1_000
  ) =>
    removalHoldStore({
      nextly: async () => table,
      collection: TABLE,
      clock: now,
    });

  it("records a hold and reads it back", async () => {
    const table = memoryTable();
    const store = storeOver(table);

    await store.hold("hero", HELD);

    expect(table.rows.every(row => row.kind === REMOVAL_HOLD)).toBe(true);
    expect(await store.of(["hero", "card"])).toEqual(
      new Map([["hero", [HELD]]])
    );
  });

  it("keeps two holds asked for at once, each ended only by its own token", async () => {
    const table = memoryTable();
    const store = storeOver(table);
    const other = { ...HELD, properties: ["body"], slots: [], token: "t2" };
    await store.hold("hero", HELD);
    await store.hold("hero", other);

    expect(await store.of(["hero"])).toEqual(
      new Map([["hero", [HELD, other]]])
    );

    await store.release("hero", "t1");

    expect(await store.of(["hero"])).toEqual(new Map([["hero", [other]]]));
  });

  it("files a hold of as many fields as an envelope may hold in a few short rows", async () => {
    const table = memoryTable();
    const store = storeOver(table);
    const many = Array.from({ length: 1000 }, (_, at) =>
      `field-${String(at)}`.padEnd(64, "x")
    );
    const big = { ...HELD, properties: many, slots: many };

    await store.hold("hero", big);

    expect(await store.of(["hero"])).toEqual(new Map([["hero", [big]]]));
    // Rows in proportion to the hold's size, not one per id (2,001 here),
    // each far under MySQL's 64 KiB TEXT.
    expect(table.rows.length).toBeLessThanOrEqual(20);
    const longest = Math.max(
      ...table.rows.map(row => String(row.exposureId).length)
    );
    expect(longest).toBeLessThan(20_000);
  });

  it("files an id longer than one row carries, whole", async () => {
    const table = memoryTable();
    const store = storeOver(table);
    // Quotes and a letter outside the BMP, so the cut falls mid-escape too.
    const long = `"é😀\\`.repeat(5_000);
    const hold = { ...HELD, properties: [long], slots: [] };

    await store.hold("hero", hold);

    expect(await store.of(["hero"])).toEqual(new Map([["hero", [hold]]]));
    expect(table.rows.length).toBeGreaterThan(2);
  });

  it("reads a hold that has run out as none", async () => {
    const table = memoryTable();
    let now = 1_000;
    const store = storeOver(table, () => now);
    await store.hold("hero", HELD);

    now = 2_000;

    expect(await store.of(["hero"])).toEqual(new Map());
  });

  it("reads rows that are not one whole hold as none", async () => {
    const table = memoryTable();
    const store = storeOver(table);
    await store.hold("hero", HELD);
    // Its head gone first, as an ending takes it, with its ids still there.
    const head = table.rows.findIndex(row =>
      String(row.exposureId).includes('"part":"head"')
    );
    table.rows.splice(head, 1);
    const unparsed = memoryTable([
      {
        id: "1",
        componentId: "hero",
        kind: REMOVAL_HOLD,
        exposureId: '{"properties":"title"}',
      },
    ]);

    expect(await store.of(["hero"])).toEqual(new Map());
    expect(await storeOver(unparsed).of(["hero"])).toEqual(new Map());
  });

  it("reads a head whose ids are missing as no hold", async () => {
    const table = memoryTable();
    const store = storeOver(table);
    await store.hold("hero", HELD);
    const id = table.rows.findIndex(row =>
      String(row.exposureId).includes('"part":"ids"')
    );
    table.rows.splice(id, 1);

    expect(await store.of(["hero"])).toEqual(new Map());
  });

  it("renews a hold in force, writing the new lease before ending the old", async () => {
    const table = memoryTable();
    const store = storeOver(table);
    await store.hold("hero", HELD);
    const heads = () =>
      table.rows.filter(row =>
        String(row.exposureId).includes('"part":"head"')
      );
    const before = heads().length;

    expect(await store.renew("hero", "t1", 9_000)).toBe(true);

    expect(before).toBe(1);
    expect(heads()).toHaveLength(1);
    expect(await store.of(["hero"])).toEqual(
      new Map([["hero", [{ ...HELD, until: 9_000 }]]])
    );
  });

  it("revives no hold that has run out, or another request's", async () => {
    const table = memoryTable();
    let now = 1_000;
    const store = storeOver(table, () => now);
    await store.hold("hero", HELD);

    expect(await store.renew("hero", "someone-else", 9_000)).toBe(false);
    now = 2_000;
    expect(await store.renew("hero", "t1", 9_000)).toBe(false);
    expect(await store.of(["hero"])).toEqual(new Map());
  });

  it("clears what ran out when it records a hold, keeping one in force", async () => {
    const table = memoryTable();
    let now = 1_000;
    const store = storeOver(table, () => now);
    await store.hold("hero", { ...HELD, token: "lapsing", until: 1_500 });
    await store.hold("hero", { ...HELD, token: "kept", until: 5_000 });
    const rows = table.rows.length;

    now = 1_600;
    await store.hold("hero", HELD);

    // The lapsed hold's part and head gone; the new one's two added.
    expect(table.rows).toHaveLength(rows);
    expect(
      (await store.of(["hero"])).get("hero")!.map(hold => hold.token)
    ).toEqual(["kept", "t1"]);
  });

  it("ends a component's every hold", async () => {
    const table = memoryTable();
    const store = storeOver(table, () => 0);
    await store.hold("hero", HELD);
    await store.hold("hero", { ...HELD, token: "t2" });

    await store.release("hero");

    expect(table.rows).toEqual([]);
  });
});

/** The fence's and the release's handlers, over a fixed set of holds. */
function harness(
  options: {
    holds?: Record<string, RemovalHold | RemovalHold[]>;
    draft?: unknown;
    failRead?: boolean;
    /** Whether the component store has the Draft/Published lifecycle. */
    lifecycle?: boolean;
    /** How many documents place each component now. */
    count?: { documents: number; complete: boolean };
  } = {}
) {
  const handlers = new Map<string, Handler>();
  const errors: string[] = [];
  const released: string[] = [];
  const draftReads: string[] = [];
  const holdsOf = async (ids: readonly string[]) => {
    if (options.failRead === true) throw new Error("database down");
    return new Map(
      ids.flatMap(id =>
        options.holds?.[id] === undefined
          ? []
          : [[id, [options.holds[id]].flat()] as const]
      )
    );
  };
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
    holds: () => ({ of: holdsOf }),
    storedDraft: async at => {
      draftReads.push(at.collection);
      return options.draft ?? null;
    },
    // `content` at the top level, and `body` inside the named group `hero`;
    // `settings` is a JSON field, which holds no placements.
    paths: async () => [["content"], ["hero", "body"]],
    limits: () => LIMITS,
    titleOf: async id => (id === "hero" ? "Hero" : undefined),
  });
  registerHoldRelease({
    ctx,
    componentCollection: "components",
    componentField: "content",
    holds: () => ({
      of: holdsOf,
      release: async (id, token) => {
        released.push(token === undefined ? id : `${id} ${token}`);
      },
    }),
    lifecycle: async () => options.lifecycle !== false,
  });
  registerPublishRecount({
    ctx,
    componentCollection: "components",
    componentField: "content",
    holds: () => ({
      of: holdsOf,
      release: async (id, token) => {
        released.push(token === undefined ? id : `${id} ${token}`);
      },
    }),
    count: async () => options.count ?? { documents: 0, complete: true },
    lifecycle: async () => options.lifecycle !== false,
  });
  const run = (phase: string, collection: string, context: Row) =>
    handlers.get(`${phase} ${collection}`)!({
      collection: "pages",
      ...context,
    });
  return { run, errors, released, draftReads };
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

  it("refuses a field held by any of a component's holds", async () => {
    const other = { ...HELD, properties: ["body"], slots: [], token: "t2" };
    const { run } = harness({ holds: { hero: [HELD, other] } });

    const error = await refusal(
      Promise.resolve(
        run("beforeUpdate", "*", {
          data: { content: page([placing("i1", "hero", { body: "new" })]) },
          originalData: { id: "p1", content: page([placing("i1", "hero")]) },
        })
      )
    );

    expect(NextlyError.isCode(error, "VALIDATION_ERROR")).toBe(true);
  });

  it("lets a document keep a held value its live row and its draft both store", async () => {
    const { run } = harness({
      holds: { hero: HELD },
      draft: { content: page([placing("i1", "hero", { title: "draft" })]) },
    });

    const kept = await refusal(
      Promise.resolve(
        run("beforeUpdate", "*", {
          data: { content: page([placing("i1", "hero", { title: "draft" })]) },
          originalData: {
            id: "p1",
            content: page([placing("i1", "hero", { title: "live" })]),
          },
        })
      )
    );

    expect(kept).toBeUndefined();
  });

  it("refuses a held value the draft lacks, though the live row stores one", async () => {
    const { run } = harness({
      holds: { hero: HELD },
      draft: { content: page([placing("i1", "hero")]) },
    });

    const error = await refusal(
      Promise.resolve(
        run("beforeUpdate", "*", {
          data: { content: page([placing("i1", "hero", { title: "new" })]) },
          originalData: {
            id: "p1",
            content: page([placing("i1", "hero", { title: "live" })]),
          },
        })
      )
    );

    expect(NextlyError.isCode(error, "VALIDATION_ERROR")).toBe(true);
  });

  it("refuses any held value inside a caller's transaction, reading no stored form", async () => {
    const { run, draftReads } = harness({ holds: { hero: HELD } });

    const error = await refusal(
      Promise.resolve(
        run("beforeUpdate", "*", {
          executor: {},
          data: { content: page([placing("i1", "hero", { title: "old" })]) },
          originalData: {
            id: "p1",
            content: page([placing("i1", "hero", { title: "old" })]),
          },
        })
      )
    );

    expect(NextlyError.isCode(error, "VALIDATION_ERROR")).toBe(true);
    expect(draftReads).toEqual([]);
  });

  it("judges only declared blocks fields, not a block-shaped value elsewhere", async () => {
    const { run } = harness({ holds: { hero: HELD } });

    const error = await refusal(
      Promise.resolve(
        run("beforeUpdate", "*", {
          data: {
            settings: page([placing("i1", "hero", { title: "archived" })]),
          },
          originalData: { id: "p1" },
        })
      )
    );

    expect(error).toBeUndefined();
  });

  it("refuses a held value newly set in one field while another field keeps one", async () => {
    const { run } = harness({ holds: { hero: HELD } });

    const error = await refusal(
      Promise.resolve(
        run("beforeUpdate", "*", {
          // Only `hero.body` is written; `content` keeps its stored value.
          data: {
            hero: { body: page([placing("i1", "hero", { title: "new" })]) },
          },
          originalData: {
            id: "p1",
            content: page([placing("i1", "hero", { title: "kept" })]),
          },
        })
      )
    );

    expect(NextlyError.isCode(error, "VALIDATION_ERROR")).toBe(true);
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
  it("ends the hold once a publish no longer exposes the held fields", async () => {
    const { run, released } = harness({ holds: { hero: HELD } });

    await run("afterUpdate", "components", {
      data: { id: "hero", status: "published", content: definition(["body"]) },
    });

    expect(released).toEqual(["hero t1"]);
  });

  it("ends only the holds whose fields the publish drops", async () => {
    const keepsBody = { ...HELD, properties: ["body"], slots: [], token: "t2" };
    const { run, released } = harness({ holds: { hero: [HELD, keepsBody] } });

    await run("afterUpdate", "components", {
      data: { id: "hero", status: "published", content: definition(["body"]) },
    });

    expect(released).toEqual(["hero t1"]);
  });

  it("keeps it through a publish that still exposes a held field", async () => {
    const { run, released } = harness({ holds: { hero: HELD } });

    await run("afterUpdate", "components", {
      data: {
        id: "hero",
        status: "published",
        content: definition(["title", "body"]),
      },
    });

    expect(released).toEqual([]);
  });

  it("keeps it through a working-draft save, a draft, and a caller's transaction", async () => {
    const { run, released } = harness();

    const content = definition(["body"]);
    await run("afterUpdate", "components", {
      data: { id: "hero", status: "published", _isWorkingDraft: true, content },
    });
    await run("afterUpdate", "components", {
      data: { id: "hero", status: "draft", content },
    });
    await run("afterUpdate", "components", {
      executor: {},
      data: { id: "hero", status: "published", content },
    });

    expect(released).toEqual([]);
  });
});

describe("counting again as a held removal is published", () => {
  const publish = (
    run: ReturnType<typeof harness>["run"],
    fields: string[] | null
  ) =>
    refusal(
      Promise.resolve(
        run("beforeUpdate", "components", {
          originalData: { id: "hero" },
          data: {
            status: "published",
            ...(fields === null ? {} : { content: definition(fields) }),
          },
        })
      )
    );

  it("refuses the publish when more documents place the component than confirmed", async () => {
    const { run } = harness({
      holds: { hero: HELD },
      count: { documents: 3, complete: true },
    });

    const error = await publish(run, ["body"]);

    expect(
      ((error as NextlyError).publicData as { errors: { code: string }[] })
        .errors[0]!.code
    ).toBe(REMOVAL_RECOUNT);
  });

  it("judges each hold the publish removes on its own count, and no other", async () => {
    // Another removal, of `body`, confirmed at none.
    const body = {
      ...HELD,
      properties: ["body"],
      slots: [],
      confirmed: 0,
      token: "t2",
    };
    const both = harness({
      holds: { hero: [HELD, body] },
      count: { documents: 2, complete: true },
    });

    // Keeping `body`: only the first hold, confirmed at 2, is judged.
    expect(await publish(both.run, ["body"])).toBeUndefined();
    // Dropping it too: the second hold's count of none has grown.
    expect(
      NextlyError.isCode(await publish(both.run, []), "VALIDATION_ERROR")
    ).toBe(true);
  });

  it("ends the holds whose count grew as it refuses, so the publish asked again can pass", async () => {
    // Another removal's hold, confirmed at 5, which the count has not passed.
    const other = { ...HELD, confirmed: 5, token: "t2" };
    const { run, released } = harness({
      holds: { hero: [HELD, other] },
      count: { documents: 3, complete: true },
    });

    const error = await publish(run, []);

    expect(NextlyError.isCode(error, "VALIDATION_ERROR")).toBe(true);
    expect(released).toEqual(["hero t1"]);
  });

  it("refuses it when a whole count confirmed is now only a floor", async () => {
    const { run } = harness({
      holds: { hero: HELD },
      count: { documents: 2, complete: false },
    });

    expect(
      NextlyError.isCode(await publish(run, null), "VALIDATION_ERROR")
    ).toBe(true);
  });

  it("refuses publishing a held removal inside a caller's transaction, counting nothing", async () => {
    const { run } = harness({ holds: { hero: HELD } });

    const error = await refusal(
      Promise.resolve(
        run("beforeUpdate", "components", {
          executor: {},
          originalData: { id: "hero" },
          data: { status: "published", content: definition(["body"]) },
        })
      )
    );

    expect(
      ((error as NextlyError).publicData as { errors: { code: string }[] })
        .errors[0]!.code
    ).toBe(REMOVAL_RECOUNT);
  });

  it("lets it through at the confirmed count, with no hold, or keeping the fields", async () => {
    const at = harness({
      holds: { hero: HELD },
      count: { documents: 2, complete: true },
    });
    const none = harness({ count: { documents: 9, complete: true } });
    const keeping = harness({
      holds: { hero: { ...HELD, slots: [] } },
      count: { documents: 9, complete: true },
    });

    expect(await publish(at.run, ["body"])).toBeUndefined();
    expect(await publish(none.run, ["body"])).toBeUndefined();
    expect(await publish(keeping.run, ["title", "body"])).toBeUndefined();
  });
});

describe("a component store with no Draft/Published lifecycle", () => {
  it("counts again on a save, every one of which puts the definition live", async () => {
    const { run } = harness({
      holds: { hero: HELD },
      lifecycle: false,
      count: { documents: 3, complete: true },
    });

    const error = await refusal(
      Promise.resolve(
        run("beforeUpdate", "components", {
          originalData: { id: "hero" },
          data: { content: definition(["body"]) },
        })
      )
    );

    expect(NextlyError.isCode(error, "VALIDATION_ERROR")).toBe(true);
  });

  it("ends the hold on the save that removes the fields", async () => {
    const { run, released } = harness({
      holds: { hero: HELD },
      lifecycle: false,
    });

    await run("afterUpdate", "components", {
      data: { id: "hero", content: definition(["body"]) },
    });

    expect(released).toEqual(["hero t1"]);
  });
});
