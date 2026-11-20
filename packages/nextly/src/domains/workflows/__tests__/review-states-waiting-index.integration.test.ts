/**
 * The review-states table's waiting index reaches an EXISTING database.
 *
 * The waiting list reads a stage's parts oldest first, `entered_at` then
 * `part_key`, a bounded number at a time. The stage index stops at `stage`, so
 * the database sorted every part of a stage before the limit;
 * `nextly_review_states_waiting_idx` (stage, then `entered_at`, `part_key`)
 * serves the order, and the limit stops the read. Index only: no column and no
 * row changes.
 *
 * A fresh database has it because the push creates the table with it. The
 * case that matters is an installation that already has the table, so each
 * dialect is reconciled once, has the index removed behind the differ's back,
 * and is reconciled again: the run `nextly migrate` and a boot make. A third
 * run must change nothing.
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

const DB_NAME = "nextly_review_waiting_idx";
const INDEXES = ["nextly_review_states_waiting_idx"] as const;

type Dialect = "postgresql" | "mysql" | "sqlite";
type Adapter = Awaited<ReturnType<typeof createAdapter>>;

/** The indexes the live database reports on `nextly_review_states`. */
async function liveIndexes(adapter: Adapter, dialect: Dialect) {
  const sql = {
    postgresql: `SELECT indexname AS name FROM pg_indexes WHERE tablename = 'nextly_review_states'`,
    mysql: `SELECT DISTINCT index_name AS name FROM information_schema.statistics
            WHERE table_schema = DATABASE() AND table_name = 'nextly_review_states'`,
    sqlite: `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'nextly_review_states'`,
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
async function holdsAll(adapter: Adapter, dialect: Dialect) {
  const live = await liveIndexes(adapter, dialect);
  return INDEXES.every(name => live.includes(name));
}

function dropStatement(name: string, dialect: Dialect): string {
  return dialect === "mysql"
    ? `DROP INDEX ${name} ON nextly_review_states`
    : `DROP INDEX "${name}"`;
}

/**
 * Reconcile, remove the index, reconcile twice more. Every reading is
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
    // The control: a fresh database has it, or "it came back" would be a
    // claim about an index that was never declared.
    const fresh = await holdsAll(connected, dialect);
    for (const name of INDEXES) {
      await connected.executeQuery(dropStatement(name, dialect));
    }
    const dropped = !(await liveIndexes(connected, dialect)).some(name =>
      (INDEXES as readonly string[]).includes(name)
    );
    const upgradeChanged = (await run()).changed;
    const upgraded = await holdsAll(connected, dialect);
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

describe("the review-states table's waiting index on an existing database", () => {
  it("is added on SQLite, and a second run changes nothing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nextly-review-waiting-idx-"));
    try {
      expect(
        await upgrade(`file:${join(dir, "existing.db")}`, "sqlite")
      ).toEqual(EXPECTED);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it.skipIf(!process.env.TEST_POSTGRES_URL)(
    "is added on PostgreSQL, and a second run changes nothing",
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
    "is added on MySQL, and a second run changes nothing",
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
