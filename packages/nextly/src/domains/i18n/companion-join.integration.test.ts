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
  db = drizzle(sqlite);
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
      localizedFieldNames: ["body"],
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
      localizedFieldNames: ["body"],
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
        localizedFieldNames: ["body"],
        rows,
        localeChain: ["en"],
      })
    ).resolves.toBeUndefined();
  });
});
