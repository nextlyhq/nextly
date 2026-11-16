/**
 * Every connection the SQLite adapter opens carries `nextly_fold_case`, the case fold the text
 * matches that ignore case call on SQLite: in memory, on a file, read-only, and after a
 * reconnect, the paths through which the adapter opens a connection.
 *
 * Each check calls the function the way a statement does, through `caseFolded` and Drizzle's
 * `sql`, on the adapter's own connection, so a connection that lacked it would refuse the
 * statement here as it would in a query. The last check is the control that makes that refusal
 * observable: a connection the adapter did not open does not have the function, and says so
 * rather than folding ASCII only.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  caseFolded,
  SQLITE_FOLD_CASE_FUNCTION,
} from "@nextlyhq/adapter-drizzle/text-match";
import BetterSqlite3 from "better-sqlite3";
import { sql } from "drizzle-orm";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { createSqliteAdapter } from "../index";

type Adapter = ReturnType<typeof createSqliteAdapter>;

const opened: Adapter[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const adapter of opened.splice(0)) await adapter.disconnect();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

async function connected(
  config: Parameters<typeof createSqliteAdapter>[0]
): Promise<Adapter> {
  const adapter = createSqliteAdapter(config);
  opened.push(adapter);
  await adapter.connect();
  return adapter;
}

/** A database file path in a directory of its own, removed after the test. */
function databaseFile(): string {
  const directory = mkdtempSync(join(tmpdir(), "nextly-sqlite-fold-"));
  directories.push(directory);
  return join(directory, "fold.db");
}

/** Folds `text` on `db` as a statement does: through `caseFolded` in Drizzle's `sql`. */
function foldedOn(db: BetterSQLite3Database, text: unknown): unknown {
  const row = db.get<{ folded: unknown }>(
    sql`select ${caseFolded("sqlite", sql`${text}`)} as folded`
  );
  return row.folded;
}

function foldedThrough(adapter: Adapter, text: unknown): unknown {
  return foldedOn(adapter.getDrizzle<BetterSQLite3Database>(), text);
}

describe("the SQLite adapter's case fold function", () => {
  it("is on an in-memory connection, folding letters outside ASCII", async () => {
    const adapter = await connected({ memory: true });

    expect(foldedThrough(adapter, "CRÈME BRÛLÉE")).toBe("crème brûlée");
    expect(foldedThrough(adapter, "İSTANBUL")).toBe("istanbul");
    expect(foldedThrough(adapter, null)).toBeNull();
  });

  it("is on a file connection, and on a read-only one opened on that file", async () => {
    const file = databaseFile();
    const writer = await connected({ url: `file:${file}` });
    expect(foldedThrough(writer, "ÄRGER")).toBe("ärger");

    const reader = await connected({ url: `file:${file}`, readonly: true });
    expect(foldedThrough(reader, "ÄRGER")).toBe("ärger");
  });

  it("is on the new connection a reconnect opens", async () => {
    const adapter = await connected({ memory: true });
    await adapter.disconnect();
    await adapter.connect();

    expect(foldedThrough(adapter, "CRÈME")).toBe("crème");
  });

  it("is missing from a connection the adapter did not open, which refuses the statement", () => {
    const raw = new BetterSqlite3(":memory:");
    let refusal: unknown;
    try {
      foldedOn(drizzle({ client: raw }), "CRÈME");
    } catch (error) {
      refusal = error;
    } finally {
      raw.close();
    }
    // Drizzle wraps the driver's error and keeps it as the cause.
    expect(refusal).toBeInstanceOf(Error);
    expect((refusal as Error).cause).toMatchObject({
      message: `no such function: ${SQLITE_FOLD_CASE_FUNCTION}`,
    });
  });
});
