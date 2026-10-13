/**
 * `nextly db:sync` creates a collection's declared compound indexes, and a
 * SQLite table rebuild keeps them.
 *
 * The sync built each collection's desired entry without its declared
 * `indexes`, so it never created one, and planned a drop of one a migration
 * had created. On SQLite a rebuild is the sharper case: the rebuilt table
 * carries no index, and only the indexes the desired schema declares are put
 * back, so a declared unique index the desired side lacked was lost and the
 * duplicates it existed to refuse were accepted from then on.
 *
 * Drives the command's own `syncCollections` against a real SQLite file. The
 * rebuild is caused by relaxing a required field: SQLite can drop NOT NULL
 * only by rebuilding the table, so the column's flag changing is the proof
 * the rebuild ran, rather than a sync that changed nothing.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defineCollection, defineConfig, text } from "../../../config";
import { indexNameForColumns } from "../../../domains/schema/services/index-name";
import { clearCachedSnapshot } from "../../../init/schema-snapshot-cache";
import type { LoadConfigResult } from "../../utils/config-loader";
import { syncCollections } from "../dev-build";

import {
  openSqliteSyncTarget,
  type SqliteSyncTarget,
} from "./helpers/sqlite-sync-target";

const TABLE = "dc_dbsync_places";
const DECLARED = indexNameForColumns(TABLE, ["country", "city"], true);

/** One collection declaring a unique (country, city) index. */
function config(cityRequired: boolean): LoadConfigResult["config"] {
  return defineConfig({
    collections: [
      defineCollection({
        slug: "dbsync_places",
        fields: [
          text({ name: "country" }),
          text({ name: "city", required: cityRequired }),
        ],
        indexes: [{ fields: ["country", "city"], unique: true }],
      }),
    ],
  });
}

let dir: string;
let target: SqliteSyncTarget | undefined;
let previousDialect: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-dbsync-indexes-"));
  previousDialect = process.env.DB_DIALECT;
  // The push skips a desired schema equal to the last one it applied, and
  // that record is process-wide: each test's database is new, so the record
  // is cleared as a new process would start without one.
  clearCachedSnapshot();
});

afterEach(async () => {
  await target?.adapter.disconnect();
  target = undefined;
  // Integration files share one fork, so a dialect left set here would be read
  // by every file that follows.
  if (previousDialect === undefined) delete process.env.DB_DIALECT;
  else process.env.DB_DIALECT = previousDialect;
  rmSync(dir, { recursive: true, force: true });
});

/** One `db:sync` of the collections in `cfg`, on a connection of its own. */
async function sync(cfg: LoadConfigResult["config"]): Promise<void> {
  process.env.DB_DIALECT = "sqlite";
  await target?.adapter.disconnect();
  target = await openSqliteSyncTarget(dir);
  await syncCollections(
    { config: cfg } as LoadConfigResult,
    target.cli,
    target.options,
    target.context
  );
}

async function query<T>(sql: string): Promise<T[]> {
  return (await target!.adapter.executeQuery(sql)) as T[];
}

/** The declared index as SQLite holds it: whether unique, and its columns in order. */
async function declaredIndex(): Promise<{
  unique: boolean;
  columns: string[];
} | null> {
  const listed = await query<{ name: string; unique: number }>(
    `PRAGMA index_list("${TABLE}")`
  );
  const entry = listed.find(index => index.name === DECLARED);
  if (entry === undefined) return null;
  const columns = await query<{ seqno: number; name: string }>(
    `PRAGMA index_info("${DECLARED}")`
  );
  return {
    unique: Number(entry.unique) === 1,
    columns: columns.sort((a, b) => a.seqno - b.seqno).map(c => c.name),
  };
}

async function cityIsNotNull(): Promise<boolean> {
  const columns = await query<{ name: string; notnull: number }>(
    `PRAGMA table_info("${TABLE}")`
  );
  return Number(columns.find(c => c.name === "city")?.notnull) === 1;
}

function insert(id: string, country: string, city: string): Promise<unknown> {
  return target!.adapter.executeQuery(
    `INSERT INTO "${TABLE}" ("id", "title", "slug", "country", "city", "created_at", "updated_at")
     VALUES ('${id}', '${id}', '${id}', '${country}', '${city}', 0, 0)`
  );
}

describe("db:sync and a collection's declared indexes (integration)", () => {
  it("creates the declared unique index, which refuses a repeated pair", async () => {
    await sync(config(true));

    expect(await declaredIndex()).toEqual({
      unique: true,
      columns: ["country", "city"],
    });

    await insert("p1", "PK", "Lahore");
    // Controls: the key is the PAIR. A unique index on either column alone
    // would refuse one of these.
    await insert("p2", "PK", "Karachi");
    await insert("p3", "IN", "Lahore");
    await expect(insert("p4", "PK", "Lahore")).rejects.toThrow(/UNIQUE/i);
  });

  it("keeps the index through a table rebuild, and it still refuses a repeated pair", async () => {
    await sync(config(true));
    await insert("p1", "PK", "Lahore");
    expect(await cityIsNotNull()).toBe(true);

    await sync(config(false));

    // The rebuild ran: nothing short of one drops NOT NULL on SQLite.
    expect(await cityIsNotNull()).toBe(false);
    // The row came through it.
    expect(await query<{ id: string }>(`SELECT "id" FROM "${TABLE}"`)).toEqual([
      { id: "p1" },
    ]);
    expect(await declaredIndex()).toEqual({
      unique: true,
      columns: ["country", "city"],
    });
    await expect(insert("p2", "PK", "Lahore")).rejects.toThrow(/UNIQUE/i);
  });
});
