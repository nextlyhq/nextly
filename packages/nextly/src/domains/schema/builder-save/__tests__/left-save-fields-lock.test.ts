/**
 * A left save's comparison is made only while no schema change holds the schema lock, before it
 * and after it: a save or settle that runs holds it, and the tables may still be moving under it.
 * While the lock is busy nothing is held over them and nothing of the comparison is kept, so the
 * next check asks again. Inside a transaction a check reads what was found before it opened,
 * holding every field where nothing was, and nothing where the lock was busy when last asked.
 *
 * The record, the registry row, the lock and the comparison are stubbed here: what is watched is
 * what the guard does with them, on MySQL in development, where it can hold a field.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerEntityRuntimeTables } from "../../../../di/register-runtime-tables";
import {
  compareBeforeTransaction,
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
}));

vi.mock("../../pipeline/schema-lock", async original => ({
  ...(await original<typeof import("../../pipeline/schema-lock")>()),
  readSchemaLockState: async () => ({ state: stubs.lock.shift() ?? "free" }),
}));
vi.mock("../save-in-progress", async original => ({
  ...(await original<typeof import("../save-in-progress")>()),
  readSavesStandingOver: async () => ({
    own: {
      key: "builder-save-in-progress:collection:posts",
      record: { id: stubs.record, applies: true },
    },
    fieldGroups: [],
  }),
}));
// The comparison finds `heading`'s column gone, as a committed rename leaves it.
vi.mock("../settle-left-save", () => ({
  fieldsNotServedOf: async () => {
    stubs.compared += 1;
    return {
      unserved: [{ field: "heading", missing: true }],
      shapeServed: true,
    };
  },
}));
vi.mock("../../../../di/service-access", () => ({
  getService: () => ({
    getCollectionBySlug: async () => ({
      tableName: "dc_posts",
      fields: [
        { name: "heading", type: "text" },
        { name: "note", type: "text" },
      ],
      status: false,
      localized: false,
    }),
  }),
}));
// The running tables the guard narrows to what the tables hold: watched, never built.
vi.mock("../../../../di/register-runtime-tables", () => ({
  registerEntityRuntimeTables: vi.fn(),
}));
vi.mock("../../../../dispatcher/helpers/di", () => ({
  getSchemaRegistryFromDI: () => undefined,
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
/** A transaction's handle, which the stubbed reads never use. */
const tx = {};

/** A write of `data` to the collection, inside a transaction where `inTx`. */
const write = (data: Record<string, unknown>, inTx = false) =>
  refuseWriteOverLeftSave({ ...posts, data, ...(inTx ? { tx } : {}) });
const refused = { code: "BUILDER_SAVE_FIELD_UNSETTLED" };

let made = 0;

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  // A record of its own each case: a comparison is kept by the id of the record it was made under.
  made += 1;
  stubs.record = `record-${made}`;
  stubs.lock = [];
  stubs.compared = 0;
  stubs.inFlow = false;
  stubs.joined = 0;
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
