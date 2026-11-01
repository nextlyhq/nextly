/**
 * Connecting with a configured schema asks for no privilege the schema does
 * not need.
 *
 * `CREATE SCHEMA IF NOT EXISTS` checks the database-level CREATE privilege
 * before it checks whether the schema exists, so a role that may use and
 * create objects in `public` — and nothing more, as a production role often
 * is — must still connect with `schema: "public"`. A schema that is missing is
 * still created, by a role that may.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PostgresAdapter } from "../index";

const TEST_DB_URL = process.env.TEST_POSTGRES_URL;

// Roles belong to the cluster, not the database, so the name carries the
// process id: two runs against one server never share a role.
const ROLE = `nx_schema_priv_${String(process.pid)}`;
const PASSWORD = "schema_priv_pw";
const MISSING_SCHEMA = `nx_schema_new_${String(process.pid)}`;
const RACED_SCHEMA = `nx_schema_raced_${String(process.pid)}`;

/** Polls `check` until it holds, failing after `timeoutMs`. */
async function waitUntil(
  check: () => Promise<boolean>,
  timeoutMs = 10_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

/** The test database's URL, signed in as `user`. */
function urlAs(user: string, password: string): string {
  const url = new URL(TEST_DB_URL ?? "");
  url.username = user;
  url.password = password;
  return url.toString();
}

describe.skipIf(!TEST_DB_URL)("connect with a configured schema", () => {
  const admin = new pg.Client({ connectionString: TEST_DB_URL });

  beforeAll(async () => {
    await admin.connect();
    const { rows } = await admin.query<{ db: string }>(
      "SELECT current_database() AS db"
    );
    const database = rows[0].db;
    await admin.query(`DROP ROLE IF EXISTS ${ROLE}`);
    // LOGIN only: no CREATEDB, not the database owner, so no CREATE on the
    // database — and with it no right to create a schema.
    await admin.query(`CREATE ROLE ${ROLE} LOGIN PASSWORD '${PASSWORD}'`);
    await admin.query(`GRANT CONNECT ON DATABASE "${database}" TO ${ROLE}`);
    await admin.query(`GRANT USAGE, CREATE ON SCHEMA public TO ${ROLE}`);
  });

  afterAll(async () => {
    await admin.query(`DROP SCHEMA IF EXISTS ${MISSING_SCHEMA}`);
    await admin.query(`DROP OWNED BY ${ROLE}`);
    await admin.query(`DROP ROLE IF EXISTS ${ROLE}`);
    await admin.end();
  });

  it("connects as a role that cannot create schemas when the schema exists", async () => {
    const adapter = new PostgresAdapter({
      url: urlAs(ROLE, PASSWORD),
      schema: "public",
    });
    try {
      await expect(adapter.connect()).resolves.toBeUndefined();
      expect(adapter.isConnected()).toBe(true);
    } finally {
      await adapter.disconnect();
    }
  });

  // Another process creates the schema while this one waits for the creation
  // lock, and this role's sessions default to serializable, which fixes a
  // transaction's snapshot at its first statement: the lock wait. A lookup
  // after the wait on that snapshot misses the schema, and the CREATE that
  // follows is refused for want of the database privilege, failing the
  // connect. The creation runs at read committed, so the lookup sees it.
  it("connects as a role that cannot create schemas when another process creates it meanwhile", async () => {
    await admin.query(`DROP SCHEMA IF EXISTS ${RACED_SCHEMA}`);
    const creator = new pg.Client({ connectionString: TEST_DB_URL });
    await creator.connect();
    const url = new URL(urlAs(ROLE, PASSWORD));
    url.searchParams.set(
      "options",
      "-c default_transaction_isolation=serializable"
    );
    const adapter = new PostgresAdapter({
      url: url.toString(),
      schema: RACED_SCHEMA,
    });
    try {
      await creator.query("BEGIN");
      await creator.query(
        "SELECT pg_advisory_xact_lock(hashtext('nextly:create-schema'), hashtext($1))",
        [RACED_SCHEMA]
      );
      await creator.query(`CREATE SCHEMA ${RACED_SCHEMA}`);
      await creator.query(`GRANT USAGE ON SCHEMA ${RACED_SCHEMA} TO ${ROLE}`);

      const connecting = adapter.connect();
      // Commit only once the adapter waits for the lock, its snapshot taken.
      await waitUntil(async () => {
        const { rows } = await admin.query(
          "SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted"
        );
        return rows.length > 0;
      });
      await creator.query("COMMIT");

      await expect(connecting).resolves.toBeUndefined();
    } finally {
      await creator.query("ROLLBACK").catch(() => {});
      await creator.end();
      await adapter.disconnect();
      await admin.query(`DROP SCHEMA IF EXISTS ${RACED_SCHEMA}`);
    }
  }, 30_000);

  it("creates the schema when it is missing", async () => {
    const adapter = new PostgresAdapter({
      url: TEST_DB_URL,
      schema: MISSING_SCHEMA,
    });
    try {
      await adapter.connect();
    } finally {
      await adapter.disconnect();
    }
    const { rows } = await admin.query(
      "SELECT 1 FROM pg_namespace WHERE nspname = $1",
      [MISSING_SCHEMA]
    );
    expect(rows).toHaveLength(1);
  });
});
