/**
 * A left save's comparison is made only while no schema change holds the schema lock, before it
 * and after it: a save or settle that runs holds it, and the tables may still be moving under it.
 * While the lock is busy nothing is held over them and nothing of the comparison is kept, so the
 * next check asks again. Inside a transaction a check reads what was found before it opened,
 * holding every field where nothing was, and nothing where the lock was busy when last asked.
 *
 * A save that changed the entity's own columns beyond its fields (its status, turned off) holds the
 * whole entity: every write of it is refused, whatever it sets, since every one reaches those columns.
 *
 * The record, the registry row, the lock and the comparison are stubbed here: what is watched is
 * what the guard does with them, on MySQL in development, where it can hold a field.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerEntityRuntimeTables } from "../../../../di/register-runtime-tables";
import {
  compareBeforeTransaction,
  refuseReadOverLeftSave,
  refuseWriteOverLeftSave,
} from "../left-save-fields";

/**
 * The lock's state at each read, in turn, free once these run out; the record standing; and how
 * many comparisons were made.
 */
const stubs = vi.hoisted(() => ({
  lock: [] as string[],
  record: "",
  compared: 0,
  inFlow: false,
  joined: 0,
  // The entity's running table as the registry of tables holds it, where the case has one.
  registry: undefined as
    | {
        getTable: () => unknown;
        registerDynamicSchema?: (name: string, table: unknown) => void;
      }
    | undefined,
  // What the comparison finds: the fields the tables do not hold, and the entity's own columns.
  found: {
    unserved: [] as Array<{ field: string; missing: boolean }>,
    required: [] as string[],
    shapeServed: true,
  },
  fields: [] as Array<{ name: string; type: string }>,
  localized: false,
}));

vi.mock("../../pipeline/schema-lock", async original => ({
  ...(await original<typeof import("../../pipeline/schema-lock")>()),
  readSchemaLockState: async () => ({ state: stubs.lock.shift() ?? "free" }),
}));
vi.mock("../save-in-progress", async original => ({
  ...(await original<typeof import("../save-in-progress")>()),
  readStandingSaves: async () => [
    {
      key: "builder-save-in-progress:collection:posts",
      record: { id: stubs.record, applies: true },
    },
  ],
}));
vi.mock("../settle-left-save", () => ({
  fieldsNotServedOf: async () => {
    stubs.compared += 1;
    return stubs.found;
  },
}));
vi.mock("../../../../di/service-access", () => ({
  getService: () => ({
    getCollectionBySlug: async () => ({
      tableName: "dc_posts",
      fields: stubs.fields,
      status: false,
      localized: stubs.localized,
    }),
  }),
}));
// The running tables the guard narrows to what the tables hold: watched, never built.
vi.mock("../../../../di/register-runtime-tables", () => ({
  registerEntityRuntimeTables: vi.fn(),
}));
vi.mock("../../../../dispatcher/helpers/di", () => ({
  getSchemaRegistryFromDI: () => stubs.registry,
  getCollectionsHandlerFromDI: () => undefined,
}));

const adapter = {
  getCapabilities: () => ({ dialect: "mysql" }),
  inTransaction: () => stubs.inFlow,
  // The calling flow's open transaction, joined: the handle the checks in it read on. What its
  // work throws comes back as a database error, as an adapter reclassifies it.
  transaction: async (work: (tx: unknown) => Promise<unknown>) => {
    stubs.joined += 1;
    return work({ getDrizzle: () => tx }).catch(() => {
      throw new Error("reclassified");
    });
  },
  getDrizzle: () => ({}),
} as unknown as DrizzleAdapter;
const posts = { adapter, kind: "collection" as const, slug: "posts" };
/** A transaction's handle, one for each case as each transaction has: what is read on it is kept by it. */
let tx = {};

/** A write of `data` to the collection, inside a transaction where `inTx`. */
const write = (data: Record<string, unknown>, inTx = false) =>
  refuseWriteOverLeftSave({ ...posts, data, ...(inTx ? { tx } : {}) });
/** The same of a write that makes a row. */
const create = (data: Record<string, unknown>, inTx = false) =>
  refuseWriteOverLeftSave({
    ...posts,
    data,
    creates: true,
    ...(inTx ? { tx } : {}),
  });
const refused = { code: "BUILDER_SAVE_FIELD_UNSETTLED" };

let made = 0;

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  // A record of its own each case: a comparison is kept by the id of the record it was made under.
  made += 1;
  tx = {};
  stubs.record = `record-${made}`;
  stubs.lock = [];
  stubs.compared = 0;
  stubs.inFlow = false;
  stubs.joined = 0;
  stubs.registry = undefined;
  stubs.localized = false;
  // The comparison finds `heading`'s column gone, as a committed rename leaves it.
  stubs.found = {
    unserved: [{ field: "heading", missing: true }],
    required: [],
    shapeServed: true,
  };
  stubs.fields = [
    { name: "heading", type: "text" },
    { name: "note", type: "text" },
  ];
  vi.mocked(registerEntityRuntimeTables).mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the left-save guard's comparison and the schema lock", () => {
  it("holds nothing while a schema change holds the lock, and compares once it is free", async () => {
    stubs.lock = ["busy"];
    await expect(write({ heading: "x" })).resolves.toBeUndefined();
    expect(stubs.compared, "nothing compared under a busy lock").toBe(0);

    await expect(write({ heading: "x" })).rejects.toMatchObject(refused);
    expect(stubs.compared).toBe(1);
  });

  it("keeps nothing of a comparison the lock was taken during, and compares again", async () => {
    // Free as the comparison starts, taken by the time it ends.
    stubs.lock = ["free", "busy"];
    await expect(write({ heading: "x" })).resolves.toBeUndefined();
    expect(stubs.compared).toBe(1);

    await expect(write({ heading: "x" })).rejects.toMatchObject(refused);
    expect(stubs.compared, "compared again, not taken from the first").toBe(2);
    // Kept once made with the lock free throughout: the next check compares nothing.
    await expect(write({ heading: "x" })).rejects.toMatchObject(refused);
    expect(stubs.compared).toBe(2);
  });

  it("narrows the running tables to the fields the tables hold, once for a record and what it misses", async () => {
    await expect(write({ heading: "x" })).rejects.toMatchObject(refused);
    await expect(write({ note: "x" })).resolves.toBeUndefined();

    const registered = vi.mocked(registerEntityRuntimeTables).mock.calls;
    expect(registered).toHaveLength(1);
    const [, entity, dialect] = registered[0]!;
    expect(entity).toMatchObject({ slug: "posts", tableName: "dc_posts" });
    expect(entity.fields.map(field => field.name)).toEqual(["note"]);
    expect(dialect).toBe("mysql");
  });

  it("narrows the running tables again where the definitions were loaded again since", async () => {
    let running: object = { loaded: 1 };
    stubs.registry = { getTable: () => running };
    await expect(write({ note: "x" })).resolves.toBeUndefined();
    await expect(write({ note: "x" })).resolves.toBeUndefined();
    const registered = vi.mocked(registerEntityRuntimeTables).mock.calls;
    expect(registered, "once for the table it registered").toHaveLength(1);

    // Every definition loaded again puts the entity's whole table back in its place.
    running = { loaded: 2 };
    await expect(write({ note: "x" })).resolves.toBeUndefined();

    expect(registered).toHaveLength(2);
    expect(registered[1]![1].fields.map(field => field.name)).toEqual(["note"]);
  });

  // A translations table is built of translated fields: with none left there is none to build, and
  // the one registered before it would go on naming the column the tables no longer hold.
  it("leaves a translations table of no field's column where it leaves out the last translated field", async () => {
    stubs.localized = true;
    stubs.fields = [
      { name: "heading", type: "text" },
      { name: "rank", type: "number" },
    ];
    const registered = new Map<string, unknown>();
    stubs.registry = {
      getTable: () => undefined,
      registerDynamicSchema: (name, table) => void registered.set(name, table),
    };
    await expect(write({ rank: 1 })).resolves.toBeUndefined();

    const translations = registered.get("dc_posts_locales");
    expect(Object.keys(translations ?? {})).toContain("_parent");
    expect(Object.keys(translations ?? {})).not.toContain("heading");
  });

  it("registers no translations table of its own where a translated field remains, or none was there", async () => {
    const registered: string[] = [];
    stubs.registry = {
      getTable: () => undefined,
      registerDynamicSchema: name => void registered.push(name),
    };
    // Every field of the collection on its main table.
    await expect(write({ note: "x" })).resolves.toBeUndefined();
    // Both translated, one of them left out: the shared registration builds the other's.
    stubs.localized = true;
    stubs.record = `${stubs.record}-again`;
    await expect(write({ note: "x" })).resolves.toBeUndefined();

    expect(registered).toEqual([]);
  });

  it("inside a transaction, holds every field where nothing was compared before it opened", async () => {
    await expect(write({ note: "x" }, true)).rejects.toMatchObject(refused);
    expect(stubs.compared, "nothing compared inside it").toBe(0);
  });

  it("joins a transaction its flow holds open and was not handed, comparing nothing on another connection", async () => {
    stubs.inFlow = true;
    // Nothing was compared before it opened, so every field is held, as for one handed over.
    await expect(write({ note: "x" })).rejects.toMatchObject(refused);
    expect(stubs.joined).toBe(1);
    expect(stubs.compared, "nothing compared inside it").toBe(0);

    // Handed over, it is read on directly.
    await expect(write({ note: "x" }, true)).rejects.toMatchObject(refused);
    expect(stubs.joined).toBe(1);
  });

  it("inside a transaction, holds nothing where the lock was busy when last asked, and what was found where it was free", async () => {
    stubs.lock = ["busy"];
    await compareBeforeTransaction(posts);
    await expect(write({ heading: "x" }, true)).resolves.toBeUndefined();

    await compareBeforeTransaction(posts);
    await expect(write({ note: "x" }, true)).resolves.toBeUndefined();
    await expect(write({ heading: "x" }, true)).rejects.toMatchObject(refused);
    expect(stubs.compared).toBe(1);
  });
});

describe("a left save that changed the entity's own columns beyond its fields", () => {
  beforeEach(() => {
    stubs.found = { unserved: [], required: [], shapeServed: false };
  });

  it("refuses a write naming the status alone, as it refuses one naming a field", async () => {
    await expect(write({ status: "published" })).rejects.toMatchObject(refused);
    await expect(write({ note: "x" })).rejects.toMatchObject(refused);
    await expect(write({})).rejects.toMatchObject(refused);
  });

  it("refuses it inside a transaction too, from what was found before it opened", async () => {
    await compareBeforeTransaction(posts);
    await expect(write({ status: "published" }, true)).rejects.toMatchObject(
      refused
    );
    expect(stubs.compared).toBe(1);
  });

  it("refuses a write of an entity whose registry row has no fields", async () => {
    stubs.fields = [];
    await expect(write({ status: "published" })).rejects.toMatchObject(refused);
  });

  it("says the whole entity is held, naming no field it did not change", async () => {
    const error: unknown = await write({ status: "published" }).catch(
      (thrown: unknown) => thrown
    );
    const said = (error as { publicMessage?: string }).publicMessage;
    expect(said).toContain('the collection "posts" was left part-way');
    expect(said).toContain("Every write and read of the collection is refused");
    expect(said).not.toContain("heading");
    expect(said).not.toContain("note");
  });

  // The control: what holds a field alone lets a write that names none go on.
  it("lets a write naming the status alone go on where only a field is held", async () => {
    stubs.found = {
      unserved: [{ field: "heading", missing: true }],
      required: [],
      shapeServed: true,
    };
    await expect(write({ status: "published" })).resolves.toBeUndefined();
    await expect(write({ heading: "x" })).rejects.toMatchObject(refused);
  });
});

describe("a left save that made a row need a value its registry row lets it leave out", () => {
  beforeEach(() => {
    stubs.found = {
      unserved: [{ field: "note", missing: false }],
      required: ["note"],
      shapeServed: true,
    };
  });

  it("refuses a new row, naming the field, whether it leaves it out or sets it", async () => {
    const said = async (data: Record<string, unknown>) => {
      const error: unknown = await create(data).catch(
        (thrown: unknown) => thrown
      );
      expect(error).toMatchObject(refused);
      return (error as { publicMessage?: string }).publicMessage;
    };
    expect(await said({ heading: "x" })).toContain('"note" required');
    expect(await said({ note: "x" })).toContain('"note" required');
  });

  it("refuses it inside a transaction too, from what was found before it opened", async () => {
    await compareBeforeTransaction(posts);
    await expect(create({ heading: "x" }, true)).rejects.toMatchObject(refused);
  });

  // The control: a row already there has its value, so a write that leaves it out goes on.
  it("lets a write of a row already there leave it out, and refuses one that sets it", async () => {
    await expect(write({ heading: "x" })).resolves.toBeUndefined();
    await expect(write({ note: "x" })).rejects.toMatchObject(refused);
  });

  it("refuses a new row for a column of no field of the row's, and nothing else", async () => {
    stubs.found = { unserved: [], required: ["alpha"], shapeServed: true };
    await expect(create({ heading: "x" })).rejects.toMatchObject(refused);
    await expect(write({ heading: "x" })).resolves.toBeUndefined();
    await expect(refuseReadOverLeftSave(posts)).resolves.toBeUndefined();
  });

  // The control: nothing a new row must be given, so only what it sets is asked about.
  it("lets a new row that sets no held field through where nothing is required of it", async () => {
    stubs.found = {
      unserved: [{ field: "heading", missing: true }],
      required: [],
      shapeServed: true,
    };
    await expect(create({ note: "x" })).resolves.toBeUndefined();
    await expect(create({ heading: "x" })).rejects.toMatchObject(refused);
  });
});
