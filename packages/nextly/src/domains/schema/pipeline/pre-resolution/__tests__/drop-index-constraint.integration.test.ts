// Dropping a managed unique on real PostgreSQL.
//
// A `unique: true` field reaches the database in one of two physical forms,
// and the index name is identical in both:
//
//   1. `ALTER TABLE ... ADD CONSTRAINT uq_* UNIQUE (...)` — what the dynamic
//      collection / component / user-ext schema services emit on Postgres.
//      The resulting index is OWNED by the constraint.
//   2. `CREATE UNIQUE INDEX uq_* ...` — what the diff's own add_index path
//      emits. A bare index with no owning constraint.
//
// Postgres rejects `DROP INDEX` against form 1 ("cannot drop index ... because
// constraint ... requires it"), and `IF EXISTS` does not suppress it — that
// clause only tolerates a missing object. Since pre-resolution drops a removed
// field's index BEFORE its column (SQLite cannot drop an indexed column), form
// 1 would fail the whole apply without the constraint-aware template.
//
// These tests build both forms deliberately and run the real executor against
// them; only a live server can prove the emitted SQL is accepted.

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { makeTestContext } from "../../../../../database/__tests__/integration/helpers/test-db";
import { buildDesiredTableFromFields } from "../../diff/build-from-fields";
import type { Operation } from "../../diff/types";
import { generatePgSQL } from "../../sql-templates/postgres";
import { executePreResolutionOps } from "../executor";

const ctx = makeTestContext("postgresql");

describe("pre-resolution drop_index — PostgreSQL constraint-backed uniques", () => {
  if (!ctx.available || !ctx.url) {
    it.skip("Skipping: TEST_POSTGRES_URL not set", () => {});
    return;
  }

  const table = `${ctx.prefix}_dc_unique_drop`;
  let pool: Pool;
  let db: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: ctx.url ?? undefined });
    db = drizzle({ client: pool });
  });

  afterAll(async () => {
    await pool.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    await pool.end();
  });

  async function resetTable(): Promise<void> {
    await pool.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);

    // Build the table through the same helpers the pipeline uses for a new
    // table — field configs to a TableSpec, TableSpec to DDL — so the fixture
    // cannot drift from the real shape. `views` carries `index: true`, which
    // is what gives it the managed idx_ index.
    const spec = buildDesiredTableFromFields(
      table,
      [
        { name: "email", type: "text" },
        { name: "code", type: "text" },
        { name: "views", type: "number", index: true },
      ] as never,
      "postgresql"
    );
    await pool.query(generatePgSQL({ type: "add_table", table: spec }));

    // Only the two form-specific uniques are added by hand, because which
    // physical form a unique takes is exactly what these cases distinguish.
    // Form 1 — constraint-owned index: what the dynamic collection, component
    // and user-ext schema services emit for a `unique: true` field on Postgres.
    await pool.query(
      `ALTER TABLE "${table}" ADD CONSTRAINT "uq_${table}_email" UNIQUE ("email")`
    );
    // Form 2 — bare unique index: what the diff's own add_index path emits.
    await pool.query(
      `CREATE UNIQUE INDEX "uq_${table}_code" ON "${table}" ("code")`
    );
  }

  async function indexNames(): Promise<string[]> {
    const res = await pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = $1`,
      [table]
    );
    return res.rows.map(r => r.indexname);
  }

  it("drops a constraint-owned unique before its column without failing the apply", async () => {
    await resetTable();

    // The op pair a removed `unique: true` field produces. The executor
    // orders drop_index first, so the constraint-owned index has to be
    // droppable while its column is still present.
    const ops: Operation[] = [
      {
        type: "drop_index",
        tableName: table,
        index: { name: `uq_${table}_email`, columns: ["email"], unique: true },
      },
      {
        type: "drop_column",
        tableName: table,
        columnName: "email",
        columnType: "text",
      },
    ];

    await expect(executePreResolutionOps(db, ops, "postgresql")).resolves.toBe(
      2
    );

    expect(await indexNames()).not.toContain(`uq_${table}_email`);
    const cols = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
      [table]
    );
    expect(cols.rows.map(r => r.column_name)).not.toContain("email");
  });

  it("drops a bare unique index the same way (constraint drop is a no-op)", async () => {
    await resetTable();

    const ops: Operation[] = [
      {
        type: "drop_index",
        tableName: table,
        index: { name: `uq_${table}_code`, columns: ["code"], unique: true },
      },
    ];

    await expect(executePreResolutionOps(db, ops, "postgresql")).resolves.toBe(
      1
    );

    expect(await indexNames()).not.toContain(`uq_${table}_code`);
    // The column itself survives — removing a unique flag is not a data drop.
    const cols = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
      [table]
    );
    expect(cols.rows.map(r => r.column_name)).toContain("code");
  });

  it("drops a plain non-unique index", async () => {
    await resetTable();
    // Guard against a vacuous pass: DROP INDEX IF EXISTS also succeeds when
    // the index was never there, so prove the builder actually created it.
    expect(await indexNames()).toContain(`idx_${table}_views`);

    const ops: Operation[] = [
      {
        type: "drop_index",
        tableName: table,
        index: {
          name: `idx_${table}_views`,
          columns: ["views"],
          unique: false,
        },
      },
    ];

    await expect(executePreResolutionOps(db, ops, "postgresql")).resolves.toBe(
      1
    );

    expect(await indexNames()).not.toContain(`idx_${table}_views`);
  });
});
