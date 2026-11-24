/**
 * The guard over writes and reads while a Builder save stands left part-way costs nothing where it
 * can hold nothing: in production, where Builder saves never run, and on PostgreSQL and SQLite,
 * where a save's change commits whole or not at all. There it returns before any statement, so no
 * handle to the database is even asked for. On MySQL in development it reads the entity's record,
 * one statement, which the control case watches it send.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { loadDialectTables } from "../../../../database/dialect-tables";
import {
  refuseReadOverLeftSave,
  refuseWriteOverLeftSave,
} from "../left-save-fields";

/** An adapter of `dialect` that counts every handle a caller asks it for, and reads no record. */
function countingAdapter(dialect: "mysql" | "postgresql" | "sqlite"): {
  adapter: DrizzleAdapter;
  handles: () => number;
} {
  let asked = 0;
  // The record read selects from `nextly_meta` by its key; no record stands.
  const db = {
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
  };
  const adapter = {
    getCapabilities: () => ({ dialect }),
    getDrizzle: () => {
      asked += 1;
      return db;
    },
  } as unknown as DrizzleAdapter;
  return { adapter, handles: () => asked };
}

/** A write and a read of one collection's entries through the guard. */
async function writeAndRead(adapter: DrizzleAdapter): Promise<void> {
  await refuseWriteOverLeftSave({
    adapter,
    kind: "collection",
    slug: "posts",
    data: { title: "A post" },
  });
  await refuseReadOverLeftSave({ adapter, kind: "collection", slug: "posts" });
}

beforeAll(async () => {
  // The record's table as MySQL declares it, which the one read in development builds its query on.
  await loadDialectTables("mysql");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the left-save guard's cost", () => {
  it("sends no statement in production, on any dialect", async () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const dialect of ["mysql", "postgresql", "sqlite"] as const) {
      const { adapter, handles } = countingAdapter(dialect);
      await writeAndRead(adapter);
      expect(handles(), dialect).toBe(0);
    }
  });

  it("sends no statement on PostgreSQL or SQLite in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    for (const dialect of ["postgresql", "sqlite"] as const) {
      const { adapter, handles } = countingAdapter(dialect);
      await writeAndRead(adapter);
      expect(handles(), dialect).toBe(0);
    }
  });

  // The control: the same counting sees the one read the guard makes where it can hold a field.
  it("reads the entity's record once per write and read on MySQL in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { adapter, handles } = countingAdapter("mysql");
    await writeAndRead(adapter);
    expect(handles()).toBe(2);
  });
});
