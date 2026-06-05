// #1 regression: findPendingFiles must not throw when the ledger table is
// absent (fresh DB), and must report all discovered files as pending.
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { findPendingFiles } from "../migrate";

let dir: string;
let sqlite: Database.Database;
let db: ReturnType<typeof drizzle>;

const logger = {
  warn: () => {},
  debug: () => {},
} as unknown as Parameters<typeof findPendingFiles>[4];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-pending-"));
  writeFileSync(join(dir, "20260101_000000_000_init.sql"), "-- UP\nSELECT 1;");
  sqlite = new Database(":memory:");
  db = drizzle(sqlite);
});

afterEach(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("findPendingFiles (fresh DB, no ledger)", () => {
  it("returns all files as pending without throwing when ledger is absent", async () => {
    const adapter = {
      tableExists: async () => false,
    } as unknown as Parameters<typeof findPendingFiles>[0];

    const pending = await findPendingFiles(adapter, db, "sqlite", dir, logger);

    expect(pending.map(p => p.name)).toEqual(["20260101_000000_000_init"]);
  });
});
