// M4 Task 2: populateCompanionFields against a real in-memory SQLite companion table.

import Database from "better-sqlite3";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { populateCompanionFields } from "./companion-join";
import { generateCompanionRuntimeSchema } from "../schema/services/runtime-schema-generator";

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle>;

beforeEach(() => {
  sqlite = new Database(":memory:");
  db = drizzle({ client: sqlite });
  sqlite.exec(
    'CREATE TABLE "dc_pages_locales" ("_parent" text, "_locale" text, "body" text)'
  );
});

afterEach(() => sqlite.close());

const companionTable = generateCompanionRuntimeSchema(
  "dc_pages_locales",
  [{ name: "body", kind: "text" }],
  "sqlite"
).table;

describe("populateCompanionFields (real SQLite)", () => {
  it("resolves each row's localized field for the requested locale, with fallback", async () => {
    db.run(
      sql`INSERT INTO "dc_pages_locales" ("_parent","_locale","body") VALUES
        ('p1','de','Hallo'), ('p1','en','Hello'),
        ('p2','en','World')`
    );
    const rows: Record<string, unknown>[] = [{ id: "p1" }, { id: "p2" }];

    await populateCompanionFields({
      db: db as never,
      companionTable,
      localizedFields: [{ name: "body", column: "body" }],
      rows,
      localeChain: ["de", "en"], // requested de, fallback en
    });

    expect(rows[0].body).toBe("Hallo"); // p1 has German
    expect(rows[1].body).toBe("World"); // p2 falls back to English
  });

  it("fallback=none (single-element chain) does not fall back", async () => {
    db.run(
      sql`INSERT INTO "dc_pages_locales" ("_parent","_locale","body") VALUES ('p2','en','World')`
    );
    const rows: Record<string, unknown>[] = [{ id: "p2" }];

    await populateCompanionFields({
      db: db as never,
      companionTable,
      localizedFields: [{ name: "body", column: "body" }],
      rows,
      localeChain: ["de"], // requested only
    });

    expect(rows[0].body).toBeNull(); // no German row, no fallback
  });

  it("is a no-op for empty rows / no localized fields", async () => {
    const rows: Record<string, unknown>[] = [];
    await expect(
      populateCompanionFields({
        db: db as never,
        companionTable,
        localizedFields: [{ name: "body", column: "body" }],
        rows,
        localeChain: ["en"],
      })
    ).resolves.toBeUndefined();
  });

  // A db whose read rejects with `err`, reusing the real companion table so the
  // query builds before the (mocked) execution fails.
  function rejectingDb(err: Error) {
    return {
      select: () => ({
        from: () => ({ where: () => Promise.reject(err) }),
      }),
    };
  }

  it("swallows a missing-table read error even in strict mode", async () => {
    const rows: Record<string, unknown>[] = [{ id: "p1" }];
    await populateCompanionFields({
      db: rejectingDb(new Error("no such table: dc_pages_locales")) as never,
      companionTable,
      localizedFields: [{ name: "body", column: "body" }],
      rows,
      localeChain: ["en"],
      strict: true,
    });
    // The unmigrated-table case is tolerated: the row is left untouched so the
    // main-table value stands.
    expect(rows[0]).not.toHaveProperty("body");
  });

  it("propagates a non-missing-table read error in strict mode", async () => {
    await expect(
      populateCompanionFields({
        db: rejectingDb(new Error("deadlock detected")) as never,
        companionTable,
        localizedFields: [{ name: "body", column: "body" }],
        rows: [{ id: "p1" }],
        localeChain: ["en"],
        strict: true,
      })
    ).rejects.toThrow("deadlock");
  });

  it("propagates a Postgres missing-COLUMN error in strict mode", async () => {
    // A migrated-but-mismatched companion (missing column) is a real schema
    // error strict mode must surface — not the tolerated missing-table case.
    await expect(
      populateCompanionFields({
        db: rejectingDb(new Error('column "body" does not exist')) as never,
        companionTable,
        localizedFields: [{ name: "body", column: "body" }],
        rows: [{ id: "p1" }],
        localeChain: ["en"],
        strict: true,
      })
    ).rejects.toThrow("does not exist");
  });

  it("tolerates a Postgres missing-RELATION error in strict mode", async () => {
    const rows: Record<string, unknown>[] = [{ id: "p1" }];
    await populateCompanionFields({
      db: rejectingDb(
        new Error('relation "dc_pages_locales" does not exist')
      ) as never,
      companionTable,
      localizedFields: [{ name: "body", column: "body" }],
      rows,
      localeChain: ["en"],
      strict: true,
    });
    expect(rows[0]).not.toHaveProperty("body");
  });

  it("swallows any read error when not strict (default)", async () => {
    await expect(
      populateCompanionFields({
        db: rejectingDb(new Error("deadlock detected")) as never,
        companionTable,
        localizedFields: [{ name: "body", column: "body" }],
        rows: [{ id: "p1" }],
        localeChain: ["en"],
      })
    ).resolves.toBeUndefined();
  });
});
