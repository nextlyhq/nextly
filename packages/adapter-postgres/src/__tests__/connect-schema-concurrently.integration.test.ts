/**
 * Processes that start together with a configured schema the database does not have yet all
 * connect.
 *
 * Each adapter looks the schema up and creates it when it is missing. `CREATE SCHEMA IF NOT
 * EXISTS` is not safe against itself on PostgreSQL: two sessions can both pass its check, and the
 * one that commits second fails with a unique violation on `pg_namespace_nspname_index` (or
 * `duplicate_schema`). Before the creation was serialized, that failure failed the connect, and
 * with it the boot. Each round drops the schema and connects several adapters at once, each with
 * a pool of its own as a separate process has, so one lucky interleaving cannot pass the case.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PostgresAdapter } from "../index";

const TEST_DB_URL = process.env.TEST_POSTGRES_URL;

/** Per run, so two runs against one server never share it. */
const SCHEMA = `nx_schema_race_${String(process.pid)}`;
/** How many processes connect together: enough that, unprotected, most rounds collide. */
const PROCESSES = 8;
const ROUNDS = 5;

describe.skipIf(!TEST_DB_URL)(
  "connect with a missing schema, several at once",
  () => {
    const admin = new pg.Client({ connectionString: TEST_DB_URL });

    beforeAll(async () => {
      await admin.connect();
    });

    afterAll(async () => {
      await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA}`);
      await admin.end();
    });

    it("every adapter connects, and the schema is created once", async () => {
      for (let round = 1; round <= ROUNDS; round++) {
        await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA}`);
        const adapters = Array.from(
          { length: PROCESSES },
          () => new PostgresAdapter({ url: TEST_DB_URL, schema: SCHEMA })
        );
        try {
          const results = await Promise.allSettled(
            adapters.map(adapter => adapter.connect())
          );
          const failures = results.flatMap(result =>
            result.status === "rejected" ? [String(result.reason)] : []
          );
          expect(failures, `round ${round}`).toEqual([]);
        } finally {
          await Promise.all(adapters.map(adapter => adapter.disconnect()));
        }
        const { rows } = await admin.query(
          "SELECT 1 FROM pg_namespace WHERE nspname = $1",
          [SCHEMA]
        );
        expect(rows).toHaveLength(1);
      }
    }, 60_000);
  }
);
