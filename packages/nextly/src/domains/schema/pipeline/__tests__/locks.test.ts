/**
 * What the schema lock says about its holder, and what `--force-unlock` clears.
 *
 * The lock itself — taking it, renewing it, waiting, refusing and releasing it, on each dialect —
 * is exercised against real databases in `schema-lock.integration.test.ts` and
 * `schema-lock-processes.integration.test.ts`. This file keeps the parts that need none.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { forceUnlock } from "../locks";
import { describeHolder } from "../schema-lock";

/** 2026-01-01T12:00:00Z, so every instant in a message is one the test can state. */
const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);

describe("describeHolder", () => {
  it("names the command, the process, when it started and when the lock lapses", () => {
    const text = describeHolder(
      {
        kind: "schema",
        owner: "build-host:4242#5f0c",
        command: "nextly migrate",
        heldForSeconds: 90,
        lapsesInSeconds: 110,
      },
      NOW
    );

    expect(text).toContain("`nextly migrate` holds it");
    expect(text).toContain("process 4242 on build-host");
    expect(text).toContain("started 90 s ago at 2026-01-01T11:58:30Z");
    expect(text).toContain(
      "If that process has stopped, the lock lapses in 110 s, at 2026-01-01T12:01:50Z"
    );
  });

  it("says a lease that has run out is free to take, rather than giving a lapse in the past", () => {
    const text = describeHolder(
      {
        kind: "schema",
        owner: "h:1#u",
        command: "nextly db:sync",
        heldForSeconds: 300,
        lapsesInSeconds: -5,
      },
      NOW
    );

    expect(text).toContain("free to take now");
    expect(text).not.toContain("lapses in");
  });

  it("names an earlier version's migrate lock and when it lapses", () => {
    const text = describeHolder(
      {
        kind: "earlier-migrate-lock",
        owner: "old-host:7:abc",
        lapsesInSeconds: 600,
      },
      NOW
    );

    expect(text).toContain("earlier Nextly version");
    expect(text).toContain("`nextly_migrate_lock`");
    expect(text).toContain("lapses in 10 min");
  });

  it("says what frees an earlier version's MySQL lock, since it has no lease", () => {
    const text = describeHolder(
      {
        kind: "earlier-mysql-lock",
        name: "nextly:migrate",
        connectionId: "12",
      },
      NOW
    );

    expect(text).toContain("`nextly:migrate` (connection 12)");
    expect(text).toContain("frees it when that connection ends");
  });

  it("names the earlier field-group lock and how to clear one nobody holds", () => {
    const text = describeHolder(
      { kind: "earlier-field-group-lock", owner: "db:sync#9" },
      NOW
    );

    expect(text).toContain("`nextly_field_group_lock`");
    expect(text).toContain("nextly migrate --force-unlock");
  });
});

describe("forceUnlock", () => {
  /** A Drizzle handle that records each statement it is handed. */
  function recordingDb() {
    const statements: string[] = [];
    return {
      statements,
      execute: vi.fn(async (q: unknown) => {
        statements.push(JSON.stringify(q));
        return { rows: [] };
      }),
      run: vi.fn((q: unknown) => {
        statements.push(JSON.stringify(q));
      }),
    };
  }

  it("clears the schema lock and both earlier locks on PostgreSQL", async () => {
    const db = recordingDb();
    await forceUnlock(db, "postgresql");

    const touched = (table: string) =>
      db.statements.some(statement => statement.includes(table));
    expect(touched("nextly_schema_lock")).toBe(true);
    expect(touched("nextly_field_group_lock")).toBe(true);
    expect(
      db.statements.some(
        statement =>
          statement.includes("DELETE") &&
          statement.includes("nextly_migrate_lock")
      )
    ).toBe(true);
  });

  it("clears the schema lock on SQLite through the handle's own call", async () => {
    const db = recordingDb();
    await forceUnlock(db, "sqlite");

    expect(db.execute).not.toHaveBeenCalled();
    expect(db.statements.some(s => s.includes("nextly_schema_lock"))).toBe(
      true
    );
    // No earlier version took a migrate lock on SQLite, so there is no row to delete.
    expect(db.statements.some(s => s.includes("nextly_migrate_lock"))).toBe(
      false
    );
  });
});

describe("schema-lock.ts loads the MySQL driver only where a MySQL lock is pinned", () => {
  it("has no top-level import of the MySQL driver", () => {
    const source = readFileSync(
      new URL("../schema-lock.ts", import.meta.url),
      "utf8"
    );

    expect(source).not.toMatch(/^import [^;]*"drizzle-orm\/mysql2"/m);
    expect(source).toContain('import("drizzle-orm/mysql2")');
  });
});
