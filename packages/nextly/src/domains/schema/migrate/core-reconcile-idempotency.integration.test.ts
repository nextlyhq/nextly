/**
 * `reconcileCore` provisions the core schema by diffing the canonical
 * definition against live introspection, so running it a second time against
 * its own output must be a no-op.
 *
 * It was not, on MySQL. The second run reported a type change for all 23
 * boolean columns and a default change for every timestamp and boolean, then
 * refused the apply as destructive — so `nextly migrate` succeeded once and
 * then failed against the schema it had just written, advising a version
 * mismatch. PostgreSQL had a narrower version of the same problem through
 * serial columns' sequence defaults.
 *
 * Each dialect gets its OWN database, created and dropped here. The property
 * under test is "the core schema agrees with itself", which only holds for a
 * database nothing else has touched — the shared integration database is
 * mutated by the ~160 suites that run alongside this one.
 */
import { createPool } from "mysql2";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";

import { createAdapter } from "../../../database/factory";
import { getSchemaEventsDdl } from "../events/schema-events-ddl";

import { reconcileCore } from "./core-reconcile";

const DB_NAME = "nextly_core_idem";

/** Run reconcileCore twice and return whether the second run saw a change. */
async function secondRunChanged(
  url: string,
  dialect: "postgresql" | "mysql"
): Promise<boolean> {
  // The adapter is handed its URL explicitly, but creating it reads pool
  // settings through the lazy env proxy, whose validation requires
  // DATABASE_URL. The canonical root scripts set only the TEST_* URL, so this
  // leg supplies it — and restores both afterwards, since the package runs its
  // integration files sequentially in one process.
  const prevUrl = process.env.DATABASE_URL;
  const prevDialect = process.env.DB_DIALECT;
  process.env.DATABASE_URL = url;
  process.env.DB_DIALECT = dialect;

  const adapter = await createAdapter({
    type: dialect,
    url,
  } as Parameters<typeof createAdapter>[0]);
  try {
    // Mirrors how `nextly migrate` bootstraps the ledger: only when it is not
    // already there. Creating it unconditionally re-runs its CREATE INDEX and
    // fails on the second pass.
    const ensureLedger = async (): Promise<void> => {
      if (await adapter.tableExists("nextly_schema_events")) return;
      for (const stmt of getSchemaEventsDdl(dialect)) {
        await adapter.executeQuery(stmt);
      }
    };
    const run = (): Promise<{ changed: boolean }> =>
      reconcileCore({
        db: adapter.getDrizzle(),
        dialect,
        logger: { info: () => {}, warn: () => {} },
        ensureLedger,
      });

    await run();
    // The second run sees the first run's output. Anything other than
    // "unchanged" means the differ disagrees with what the applier wrote — and
    // because the core diff refuses destructive ops, that disagreement is
    // fatal rather than cosmetic.
    return (await run()).changed;
  } finally {
    // The pool would otherwise stay open for the rest of the run, which is a
    // single process shared with every other integration file.
    await adapter.disconnect?.();
    process.env.DATABASE_URL = prevUrl;
    process.env.DB_DIALECT = prevDialect;
  }
}

describe.skipIf(!process.env.TEST_POSTGRES_URL)(
  "reconcileCore idempotency (postgresql)",
  () => {
    it("reports no change on a second run", async () => {
      const admin = new Pool({
        connectionString: process.env.TEST_POSTGRES_URL,
      });
      await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
      await admin.query(`CREATE DATABASE ${DB_NAME}`);
      const url = new URL(process.env.TEST_POSTGRES_URL as string);
      url.pathname = `/${DB_NAME}`;
      const pool = new Pool({ connectionString: url.toString() });
      try {
        const changed = await secondRunChanged(url.toString(), "postgresql");
        expect(changed).toBe(false);
      } finally {
        await pool.end();
        await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`).catch(() => {});
        await admin.end();
      }
    });
  }
);

describe.skipIf(!process.env.TEST_MYSQL_URL)(
  "reconcileCore idempotency (mysql)",
  () => {
    it("reports no change on a second run", async () => {
      const admin = createPool({ uri: process.env.TEST_MYSQL_URL });
      await admin.promise().query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
      await admin.promise().query(`CREATE DATABASE ${DB_NAME}`);
      const url = new URL(process.env.TEST_MYSQL_URL as string);
      url.pathname = `/${DB_NAME}`;
      const pool = createPool({ uri: url.toString() });
      try {
        const changed = await secondRunChanged(url.toString(), "mysql");
        expect(changed).toBe(false);
      } finally {
        await new Promise<void>(res => pool.end(() => res()));
        await admin
          .promise()
          .query(`DROP DATABASE IF EXISTS ${DB_NAME}`)
          .catch(() => {});
        await new Promise<void>(res => admin.end(() => res()));
      }
    });
  }
);
