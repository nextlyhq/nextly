/**
 * A string narrowing on PostgreSQL keeps a value that does not fit, through both renderers: the
 * statement a migration file carries (`generateSQL`) and the one a dev apply runs (`emitPostgresDdl`).
 * PostgreSQL's explicit `::varchar(N)` cast cuts an overlong string to N characters without an
 * error; the assignment cast an ALTER uses without one refuses it, which is what keeps the value.
 *
 * Self-skips when TEST_POSTGRES_URL is unset. Each run uses a table of its own.
 */
import { randomBytes } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Operation } from "../../diff/types";
import { emitPostgresDdl } from "../../ddl-emitter/postgres";
import { generateSQL } from "../index";

const PG_URL = process.env.TEST_POSTGRES_URL ?? "";
const describePg = describe.skipIf(!PG_URL);

const TABLE = `nx_narrow_${randomBytes(4).toString("hex")}`;
const narrowing: Operation = {
  type: "change_column_type",
  tableName: TABLE,
  columnName: "title",
  fromType: "text",
  toType: "varchar(255)",
};

describePg(
  "a PostgreSQL string narrowing over a value that does not fit",
  () => {
    let pool: Pool;

    beforeAll(() => {
      pool = new Pool({ connectionString: PG_URL });
    });

    afterAll(async () => {
      await pool.query(`DROP TABLE IF EXISTS "${TABLE}"`);
      await pool.end();
    });

    beforeEach(async () => {
      await pool.query(`DROP TABLE IF EXISTS "${TABLE}"`);
      await pool.query(`CREATE TABLE "${TABLE}" (title text)`);
      await pool.query(`INSERT INTO "${TABLE}" (title) VALUES ($1)`, [
        "x".repeat(300),
      ]);
    });

    const stored = async () => {
      const { rows } = await pool.query<{ n: number; t: string }>(
        `SELECT char_length(title) AS n, pg_typeof(title)::text AS t FROM "${TABLE}"`
      );
      return rows[0];
    };

    it.each([
      [
        "the migration file's statement",
        () => generateSQL(narrowing, "postgresql"),
      ],
      [
        "the dev apply's statement",
        () => emitPostgresDdl(narrowing).join("; "),
      ],
    ])("%s is refused and the value kept", async (_label, render) => {
      await expect(pool.query(render())).rejects.toThrow(/value too long/);
      expect(await stored()).toEqual({ n: 300, t: "text" });
    });
  }
);
