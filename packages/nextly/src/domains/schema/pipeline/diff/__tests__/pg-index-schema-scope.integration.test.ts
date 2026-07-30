/**
 * Which schema's indexes a Postgres snapshot reports.
 *
 * `pg_class.relname` is unique per schema rather than per database, so a table
 * name introspected without a namespace filter matches every schema that
 * happens to hold that name. The columns are already scoped to `public`; the
 * indexes have to be scoped the same way, or a table's snapshot carries indexes
 * that are not on it — which reads as "this index already exists" to the diff
 * and as "an index went missing" to anything comparing a rename's before and
 * after.
 *
 * A same-named table in a second schema is not hypothetical: search_path
 * layouts, staging copies and per-tenant schemas all produce one.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { introspectLiveSnapshot } from "../introspect-live";
import type { TableSpec } from "../types";

const TABLE = "nextly_idxscope_posts";
const OTHER_SCHEMA = "nextly_idxscope_other";
const PUBLIC_INDEX = "nextly_idxscope_public_ix";
const OTHER_INDEX = "nextly_idxscope_other_ix";

describe.skipIf(!process.env.TEST_POSTGRES_URL)(
  "postgres index introspection schema scope",
  () => {
    let pool: Pool;
    let table: TableSpec | undefined;

    beforeAll(async () => {
      pool = new Pool({ connectionString: process.env.TEST_POSTGRES_URL });
      await pool.query(`DROP TABLE IF EXISTS "${TABLE}" CASCADE`);
      await pool.query(`DROP SCHEMA IF EXISTS "${OTHER_SCHEMA}" CASCADE`);

      await pool.query(
        `CREATE TABLE "${TABLE}" (id serial PRIMARY KEY, slug text)`
      );
      await pool.query(`CREATE INDEX "${PUBLIC_INDEX}" ON "${TABLE}" (slug)`);

      // Same table name, different schema, different index. Only the first of
      // those distinguishes it in a query that filters on relname alone.
      await pool.query(`CREATE SCHEMA "${OTHER_SCHEMA}"`);
      await pool.query(
        `CREATE TABLE "${OTHER_SCHEMA}"."${TABLE}" (id serial PRIMARY KEY, slug text)`
      );
      await pool.query(
        `CREATE INDEX "${OTHER_INDEX}" ON "${OTHER_SCHEMA}"."${TABLE}" (slug)`
      );

      const live = await introspectLiveSnapshot(
        drizzle({ client: pool }),
        "postgresql",
        [TABLE]
      );
      table = live.tables.find(entry => entry.name === TABLE);
    });

    afterAll(async () => {
      await pool.query(`DROP TABLE IF EXISTS "${TABLE}" CASCADE`);
      await pool.query(`DROP SCHEMA IF EXISTS "${OTHER_SCHEMA}" CASCADE`);
      await pool.end();
    });

    it("reports the public table's own index", () => {
      expect(table?.indexes?.map(index => index.name)).toContain(PUBLIC_INDEX);
    });

    it("does not report an index from a same-named table in another schema", () => {
      expect(table?.indexes?.map(index => index.name)).not.toContain(
        OTHER_INDEX
      );
    });

    it("reports exactly the indexes the public table has", () => {
      // Asserted as a set as well as by name: a merge that happened to reuse an
      // index name would pass both checks above while still describing a table
      // this snapshot was never asked about.
      expect(table?.indexes?.map(index => index.name).sort()).toEqual([
        PUBLIC_INDEX,
      ]);
    });
  }
);
