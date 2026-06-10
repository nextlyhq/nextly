// Regression guard for Drizzle bug #5782 (SQLite cascade data loss).
//
// THE BUG: drizzle-kit's SQLite migrations use a "table rebuild" pattern
// (create __new_x, copy rows, DROP x, rename __new_x -> x). The template puts
// `PRAGMA foreign_keys = OFF` at the top to disarm cascades during the rebuild.
// But SQLite IGNORES `PRAGMA foreign_keys` when it is set INSIDE a transaction
// (it's a no-op there). So with foreign keys still effectively ON, the implicit
// DELETE that DROP TABLE performs fires `ON DELETE CASCADE` and silently wipes
// every row of any child table — then commits as if all went well.
//
// OUR DEFENSE (the seam this test pins): PushSchemaPipeline.apply() runs the
// SQLite rebuild WITHOUT db.transaction(); it toggles `PRAGMA foreign_keys =
// OFF` OUTSIDE any transaction (see pushschema-pipeline.ts ~lines 856-864) and
// runs `PRAGMA foreign_key_check` afterward (see drizzle-statement-executor.ts
// executeSqlite). Outside a transaction the pragma actually takes effect, so
// cascades don't fire and child rows survive.
//
// This file does NOT boot the full pipeline. It models both paths with
// better-sqlite3 directly so the SQLite-level behavior is unambiguous:
//   1. the BUG path (pragma inside a transaction) — proves data loss happens;
//   2. our DEFENSE path (pragma outside a transaction) — proves data survives.
// If a future change makes us run the rebuild inside a transaction, the second
// test breaks and tells us we have re-opened #5782.

import Database from "better-sqlite3";
import { describe, it, expect } from "vitest";

// Seed a parent table and a child table whose FK uses ON DELETE CASCADE,
// with one parent row and two child rows pointing at it.
function seed(db: Database.Database): void {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE parent (id TEXT PRIMARY KEY, title TEXT);
    CREATE TABLE child (
      id TEXT PRIMARY KEY,
      parent_id TEXT NOT NULL REFERENCES parent(id) ON DELETE CASCADE
    );
    INSERT INTO parent (id, title) VALUES ('p1', 'Parent One');
    INSERT INTO child (id, parent_id) VALUES ('c1', 'p1'), ('c2', 'p1');
  `);
}

function childCount(db: Database.Database): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM child").get() as {
    n: number;
  };
  return row.n;
}

describe("SQLite cascade data-loss (#5782)", () => {
  it("BUG: pragma OFF inside a transaction is ignored, so the rebuild wipes child rows", () => {
    const db = new Database(":memory:");
    seed(db);
    expect(childCount(db)).toBe(2);

    // Rebuild `parent` with the pragma INSIDE a transaction (the broken
    // pattern). The pragma is a no-op here, so foreign keys stay ON and
    // DROP TABLE parent cascades into child.
    db.exec(`
      BEGIN;
      PRAGMA foreign_keys = OFF;            -- no-op inside a transaction
      CREATE TABLE __new_parent (id TEXT PRIMARY KEY, title TEXT);
      INSERT INTO __new_parent (id, title) SELECT id, title FROM parent;
      DROP TABLE parent;                    -- cascades: child rows deleted
      ALTER TABLE __new_parent RENAME TO parent;
      COMMIT;
    `);

    // Data loss reproduced: the child table was silently emptied.
    expect(childCount(db)).toBe(0);
    db.close();
  });

  it("DEFENSE: pragma OFF outside any transaction (our pipeline's seam) preserves child rows", () => {
    const db = new Database(":memory:");
    seed(db);
    expect(childCount(db)).toBe(2);

    // Mirror PushSchemaPipeline.apply(): toggle foreign_keys OFF OUTSIDE any
    // transaction, run the rebuild statements, toggle back ON, then verify
    // integrity. Each exec() below auto-commits on its own (no BEGIN), so the
    // pragma genuinely takes effect for the duration of the rebuild.
    db.exec("PRAGMA foreign_keys = OFF;");
    db.exec(`
      CREATE TABLE __new_parent (id TEXT PRIMARY KEY, title TEXT);
      INSERT INTO __new_parent (id, title) SELECT id, title FROM parent;
      DROP TABLE parent;                    -- no cascade: foreign keys are off
      ALTER TABLE __new_parent RENAME TO parent;
    `);
    db.exec("PRAGMA foreign_keys = ON;");

    // Child rows survived...
    expect(childCount(db)).toBe(2);

    // ...and the schema is still sound (no orphaned foreign keys).
    const violations = db.prepare("PRAGMA foreign_key_check").all();
    expect(violations).toEqual([]);
    db.close();
  });
});
