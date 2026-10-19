/**
 * The releases table's time-led indexes reach an EXISTING database.
 *
 * The calendar and the list's day filter read releases by when they happen:
 * `scheduled_at`, or `published_at` for a published one. The table's due
 * index leads with `state`, so it cannot serve a range on either instant on
 * its own; `nextly_releases_scheduled_idx` and `nextly_releases_published_idx`
 * can. Index only: no column and no row changes.
 *
 * A fresh database has them because the push creates the table with them.
 * The case that matters is an installation that already has the table, so
 * each dialect is reconciled once, has both indexes removed behind the
 * differ's back, and is reconciled again — the run `nextly migrate` and a
 * boot make. A third run must change nothing.
 *
 * Each dialect gets a database of its own, created and dropped here, for the
 * reason `core-index-reconcile.integration.test.ts` gives.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPool } from "mysql2";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";

import { createAdapter } from "../../../database/factory";
import { getSchemaEventsDdl } from "../../schema/events/schema-events-ddl";
import { reconcileCore } from "../../schema/migrate/core-reconcile";

const DB_NAME = "nextly_release_time_idx";
const INDEXES = [
  "nextly_releases_scheduled_idx",
  "nextly_releases_published_idx",
] as const;

type Dialect = "postgresql" | "mysql" | "sqlite";
type Adapter = Awaited<ReturnType<typeof createAdapter>>;

/** The indexes the live database reports on `nextly_releases`. */
async function liveIndexes(adapter: Adapter, dialect: Dialect) {
  const sql = {
    postgresql: `SELECT indexname AS name FROM pg_indexes WHERE tablename = 'nextly_releases'`,
    mysql: `SELECT DISTINCT index_name AS name FROM information_schema.statistics
            WHERE table_schema = DATABASE() AND table_name = 'nextly_releases'`,
    sqlite: `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'nextly_releases'`,
  }[dialect];
  const rows = (await adapter.executeQuery(sql)) as unknown;
  const list = Array.isArray(rows)
    ? rows
    : ((rows as { rows?: unknown[] }).rows ?? []);
  return (Array.isArray(list[0]) ? (list[0] as unknown[]) : list).map(row =>
    String((row as { name?: string; NAME?: string }).name ?? "")
  );
}

/** Whether the live table holds every index this suite is about. */
async function holdsBoth(adapter: Adapter, dialect: Dialect) {
  const live = await liveIndexes(adapter, dialect);
  return INDEXES.every(name => live.includes(name));
}

function dropStatement(name: string, dialect: Dialect): string {
  return dialect === "mysql"
    ? `DROP INDEX ${name} ON nextly_releases`
    : `DROP INDEX "${name}"`;
}

/**
 * Reconcile, remove both indexes, reconcile twice more. Every reading is
 * returned, because they only mean something together: indexes restored by
 * a run that reported no change would have been put there by something else.
 */
async function upgrade(url: string, dialect: Dialect) {
  const prevUrl = process.env.DATABASE_URL;
  const prevDialect = process.env.DB_DIALECT;
  let adapter: Adapter | undefined;
  try {
    process.env.DATABASE_URL = url;
    process.env.DB_DIALECT = dialect;
    const connected = await createAdapter({
      type: dialect,
      url,
    } as Parameters<typeof createAdapter>[0]);
    adapter = connected;
    const run = () =>
      reconcileCore({
        db: connected.getDrizzle(),
        dialect,
        logger: { info: () => {}, warn: () => {} },
        ensureLedger: async () => {
          if (await connected.tableExists("nextly_schema_events")) return;
          for (const stmt of getSchemaEventsDdl(dialect)) {
            await connected.executeQuery(stmt);
          }
        },
      });

    await run();
    // The control: a fresh database has both, or "they came back" would be a
    // claim about indexes that were never declared.
    const fresh = await holdsBoth(connected, dialect);
    for (const name of INDEXES) {
      await connected.executeQuery(dropStatement(name, dialect));
    }
    const dropped = !(await liveIndexes(connected, dialect)).some(name =>
      (INDEXES as readonly string[]).includes(name)
    );
    const upgradeChanged = (await run()).changed;
    const upgraded = await holdsBoth(connected, dialect);
    const againChanged = (await run()).changed;
    return { fresh, dropped, upgradeChanged, upgraded, againChanged };
  } finally {
    await adapter?.disconnect?.();
    if (prevUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevUrl;
    if (prevDialect === undefined) delete process.env.DB_DIALECT;
    else process.env.DB_DIALECT = prevDialect;
  }
}

const EXPECTED = {
  fresh: true,
  dropped: true,
  upgradeChanged: true,
  upgraded: true,
  againChanged: false,
};

describe("the releases table's time indexes on an existing database", () => {
  it("are added on SQLite, and a second run changes nothing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nextly-release-time-idx-"));
    try {
      expect(
        await upgrade(`file:${join(dir, "existing.db")}`, "sqlite")
      ).toEqual(EXPECTED);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it.skipIf(!process.env.TEST_POSTGRES_URL)(
    "are added on PostgreSQL, and a second run changes nothing",
    async () => {
      const admin = new Pool({
        connectionString: process.env.TEST_POSTGRES_URL,
      });
      try {
        await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
        await admin.query(`CREATE DATABASE ${DB_NAME}`);
        const url = new URL(process.env.TEST_POSTGRES_URL as string);
        url.pathname = `/${DB_NAME}`;
        expect(await upgrade(url.toString(), "postgresql")).toEqual(EXPECTED);
      } finally {
        await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`).catch(() => {});
        await admin.end();
      }
    },
    60_000
  );

  it.skipIf(!process.env.TEST_MYSQL_URL)(
    "are added on MySQL, and a second run changes nothing",
    async () => {
      const admin = createPool({
        uri: process.env.TEST_MYSQL_URL as string,
        multipleStatements: false,
      }).promise();
      try {
        await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
        await admin.query(`CREATE DATABASE ${DB_NAME}`);
        const url = new URL(process.env.TEST_MYSQL_URL as string);
        url.pathname = `/${DB_NAME}`;
        expect(await upgrade(url.toString(), "mysql")).toEqual(EXPECTED);
      } finally {
        await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`).catch(() => {});
        await admin.end();
      }
    },
    60_000
  );
});
