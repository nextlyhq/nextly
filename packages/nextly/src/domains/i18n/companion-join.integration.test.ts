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
      readiness: "ready",
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
      readiness: "ready",
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
        // "ready" so the empty-rows short-circuit is what returns here, not the
        // upstream readiness gate (which returns before the rows are inspected).
        readiness: "ready",
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

  it("does not touch the database at all when the companion is not ready", async () => {
    // Deciding existence by running the join and catching the failure is free on SQLite and
    // MySQL and marks a PostgreSQL transaction aborted — and several of these reads run inside the
    // caller's write transaction. A db that rejects every query stands in for that: if anything is
    // issued at all, this rejects.
    const rows: Record<string, unknown>[] = [{ id: "p1" }];
    await populateCompanionFields({
      db: rejectingDb(new Error("should never be issued")) as never,
      companionTable,
      localizedFields: [{ name: "body", column: "body" }],
      rows,
      localeChain: ["en"],
      readiness: "pre-migration",
    });
    // Left untouched, so the main table's value stands.
    expect(rows[0]).not.toHaveProperty("body");
  });

  it("does not touch the database when readiness was never resolved", async () => {
    // Callers inside a transaction read a remembered verdict, which is undefined when nothing has
    // resolved this entity. Unknown must mean not-usable, never provisioned: guessing provisioned
    // is what issues the query this exists to avoid.
    const rows: Record<string, unknown>[] = [{ id: "p1" }];
    await populateCompanionFields({
      db: rejectingDb(new Error("should never be issued")) as never,
      companionTable,
      localizedFields: [{ name: "body", column: "body" }],
      rows,
      localeChain: ["en"],
      readiness: undefined,
    });
    expect(rows[0]).not.toHaveProperty("body");
  });

  it("propagates every read failure once the companion is ready", async () => {
    // There is no longer a tolerated class. Swallowing a failure here left the caller with the
    // main row's value, which it could not tell apart from a translation that genuinely says so —
    // and on a durable webhook or version payload that difference is the whole record.
    for (const message of [
      "deadlock detected",
      'column "body" does not exist',
      'relation "dc_pages_locales" does not exist',
      "no such table: dc_pages_locales",
    ]) {
      await expect(
        populateCompanionFields({
          db: rejectingDb(new Error(message)) as never,
          companionTable,
          localizedFields: [{ name: "body", column: "body" }],
          rows: [{ id: "p1" }],
          localeChain: ["en"],
          readiness: "ready",
        })
      ).rejects.toThrow(message);
    }
  });
});
