/**
 * Which `nextval()` defaults the snapshot marks as owned.
 *
 * A `serial` column's default is the sequence PostgreSQL creates and gives it;
 * the diff suppresses that one, because the desired side never spells it. Any
 * other `nextval()` default was pointed there deliberately and has to keep
 * being reported — and the two are indistinguishable by expression, since a
 * serial column can be repointed at a foreign sequence and still read as
 * `nextval('...'::regclass)`.
 *
 * Ownership is therefore read from the server rather than inferred from the
 * shape of the default, and this suite is what proves the reading is right.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { introspectLiveSnapshot } from "../introspect-live";
import type { ColumnSpec } from "../types";

const SERIAL_TABLE = "nextly_seqown_serial";
const REPOINTED_TABLE = "nextly_seqown_repointed";
const CUSTOM_SEQUENCE = "nextly_seqown_custom_seq";
const TABLES = [SERIAL_TABLE, REPOINTED_TABLE];

describe.skipIf(!process.env.TEST_POSTGRES_URL)(
  "postgres sequence-default ownership",
  () => {
    let pool: Pool;
    let columns: Map<string, ColumnSpec>;

    beforeAll(async () => {
      pool = new Pool({ connectionString: process.env.TEST_POSTGRES_URL });
      await pool.query(`DROP TABLE IF EXISTS "${SERIAL_TABLE}" CASCADE`);
      await pool.query(`DROP TABLE IF EXISTS "${REPOINTED_TABLE}" CASCADE`);
      await pool.query(`DROP SEQUENCE IF EXISTS "${CUSTOM_SEQUENCE}" CASCADE`);

      await pool.query(`CREATE SEQUENCE "${CUSTOM_SEQUENCE}"`);
      // Owns its sequence, and draws from it: what `serial` produces.
      await pool.query(
        `CREATE TABLE "${SERIAL_TABLE}" (id serial PRIMARY KEY, n integer)`
      );
      // Still owns a sequence, but its default draws from another one. The
      // expression is identical in shape to the case above.
      await pool.query(
        `CREATE TABLE "${REPOINTED_TABLE}" (id serial PRIMARY KEY)`
      );
      await pool.query(
        `ALTER TABLE "${REPOINTED_TABLE}"
           ALTER COLUMN id SET DEFAULT nextval('${CUSTOM_SEQUENCE}')`
      );

      const live = await introspectLiveSnapshot(
        drizzle({ client: pool }),
        "postgresql",
        TABLES
      );
      columns = new Map(
        live.tables.flatMap(t => t.columns.map(c => [`${t.name}.${c.name}`, c]))
      );
    });

    afterAll(async () => {
      await pool.query(`DROP TABLE IF EXISTS "${SERIAL_TABLE}" CASCADE`);
      await pool.query(`DROP TABLE IF EXISTS "${REPOINTED_TABLE}" CASCADE`);
      await pool
        .query(`DROP SEQUENCE IF EXISTS "${CUSTOM_SEQUENCE}" CASCADE`)
        .catch(() => {});
      await pool.end();
    });

    it("marks a serial column's own sequence as owned", () => {
      const id = columns.get(`${SERIAL_TABLE}.id`);
      expect(id?.default).toMatch(/^nextval\(/);
      expect(id?.ownedSequenceDefault).toBe(true);
    });

    it("does not mark a sequence the column does not own", () => {
      // The reason ownership is read from the server: this default is the
      // same shape as the one above and must still be reconciled.
      const id = columns.get(`${REPOINTED_TABLE}.id`);
      expect(id?.default).toMatch(/^nextval\(/);
      expect(id?.ownedSequenceDefault).toBeUndefined();
    });

    it("leaves a column with no default unmarked", () => {
      const n = columns.get(`${SERIAL_TABLE}.n`);
      expect(n?.default).toBeUndefined();
      expect(n?.ownedSequenceDefault).toBeUndefined();
    });
  }
);
