/**
 * An index added to a core table reaches an EXISTING database.
 *
 * 🔴 It did not. `getCoreSchema()` built each core table through
 * `drizzleTableToTableSpec()`, which omitted indexes, and `diffIndexes` skips
 * any table whose `indexes` is `undefined` — so an index-only release produced
 * no operations, `reconcileCore` returned `changed: false` before reaching the
 * push, and only databases created AFTER the release ever got the index. Every
 * upgraded installation kept the behaviour the index existed to remove, and
 * nothing anywhere reported a difference: the declaration was present, the
 * schema test passed, and `nextly migrate` said the core schema was up to date.
 *
 * The drop-and-reconcile shape is the point. Asserting that a fresh database
 * has the index proves nothing about this, because a fresh database is created
 * by the push and always had it — the failing case is a database that exists,
 * is otherwise current, and is missing exactly one index.
 *
 * Each dialect gets its own database for the reason the idempotency suite
 * beside this one gives: the property is about a database nothing else has
 * touched.
 */
import { createPool } from "mysql2";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";

import { createAdapter } from "../../../database/factory";
import { getSchemaEventsDdl } from "../events/schema-events-ddl";

import { reconcileCore } from "./core-reconcile";

const DB_NAME = "nextly_core_index";
const INDEX = "nextly_versions_pending_edits_idx";

/** The indexes the live database reports on `nextly_versions`. */
async function liveIndexes(
  adapter: { executeQuery: (sql: string) => Promise<unknown> },
  dialect: "postgresql" | "mysql"
): Promise<string[]> {
  const sql =
    dialect === "postgresql"
      ? `SELECT indexname AS name FROM pg_indexes WHERE tablename = 'nextly_versions'`
      : `SELECT DISTINCT index_name AS name FROM information_schema.statistics
         WHERE table_schema = DATABASE() AND table_name = 'nextly_versions'`;
  const rows = (await adapter.executeQuery(sql)) as unknown;
  const list = Array.isArray(rows)
    ? rows
    : ((rows as { rows?: unknown[] }).rows ?? []);
  return (Array.isArray(list[0]) ? (list[0] as unknown[]) : list).map(row =>
    String((row as { name?: string; NAME?: string }).name ?? "")
  );
}

/**
 * Reconcile, remove the index behind the differ's back, reconcile again.
 *
 * Returns what the second reconcile reported and whether the index came back,
 * because both matter and only together: an index restored by a run that
 * reported `changed: false` would mean something else put it there.
 */
async function dropThenReconcile(
  url: string,
  dialect: "postgresql" | "mysql"
): Promise<{ before: boolean; reported: boolean; after: boolean }> {
  const prevUrl = process.env.DATABASE_URL;
  const prevDialect = process.env.DB_DIALECT;
  const restoreEnv = (): void => {
    if (prevUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevUrl;
    if (prevDialect === undefined) delete process.env.DB_DIALECT;
    else process.env.DB_DIALECT = prevDialect;
  };

  let adapter: Awaited<ReturnType<typeof createAdapter>> | undefined;
  try {
    process.env.DATABASE_URL = url;
    process.env.DB_DIALECT = dialect;
    const connected = await createAdapter({
      type: dialect,
      url,
    } as Parameters<typeof createAdapter>[0]);
    adapter = connected;

    const ensureLedger = async (): Promise<void> => {
      if (await connected.tableExists("nextly_schema_events")) return;
      for (const stmt of getSchemaEventsDdl(dialect)) {
        await connected.executeQuery(stmt);
      }
    };
    const run = (): Promise<{ changed: boolean }> =>
      reconcileCore({
        db: connected.getDrizzle(),
        dialect,
        logger: { info: () => {}, warn: () => {} },
        ensureLedger,
      });

    await run();
    // The control: the database this test then breaks must have had the index,
    // or "it came back" would be a claim about an index that was never there.
    const before = (await liveIndexes(connected, dialect)).includes(INDEX);

    await connected.executeQuery(
      dialect === "postgresql"
        ? `DROP INDEX "${INDEX}"`
        : `DROP INDEX ${INDEX} ON nextly_versions`
    );

    const reported = (await run()).changed;
    const after = (await liveIndexes(connected, dialect)).includes(INDEX);
    return { before, reported, after };
  } finally {
    await adapter?.disconnect?.();
    restoreEnv();
  }
}

describe.skipIf(!process.env.TEST_POSTGRES_URL)(
  "core index reconciliation (postgresql)",
  () => {
    it("restores an index missing from an existing database", async () => {
      const admin = new Pool({
        connectionString: process.env.TEST_POSTGRES_URL,
      });
      try {
        await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
        await admin.query(`CREATE DATABASE ${DB_NAME}`);
        const url = new URL(process.env.TEST_POSTGRES_URL as string);
        url.pathname = `/${DB_NAME}`;
        const outcome = await dropThenReconcile(url.toString(), "postgresql");
        expect(outcome).toEqual({
          before: true,
          reported: true,
          after: true,
        });
      } finally {
        await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`).catch(() => {});
        await admin.end();
      }
    }, 60_000);
  }
);

describe.skipIf(!process.env.TEST_MYSQL_URL)(
  "core index reconciliation (mysql)",
  () => {
    it("restores an index missing from an existing database", async () => {
      const admin = createPool({
        uri: process.env.TEST_MYSQL_URL as string,
        multipleStatements: false,
      }).promise();
      try {
        await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
        await admin.query(`CREATE DATABASE ${DB_NAME}`);
        const url = new URL(process.env.TEST_MYSQL_URL as string);
        url.pathname = `/${DB_NAME}`;
        const outcome = await dropThenReconcile(url.toString(), "mysql");
        expect(outcome).toEqual({
          before: true,
          reported: true,
          after: true,
        });
      } finally {
        await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`).catch(() => {});
        await admin.end();
      }
    }, 60_000);
  }
);
