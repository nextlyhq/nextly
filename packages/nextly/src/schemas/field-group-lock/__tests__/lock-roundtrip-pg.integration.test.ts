/**
 * A lock table built by the bootstrap DDL must round-trip through the reconciler with no churn.
 *
 * Two things create `nextly_field_group_lock`: `getMigrationLockDdl`, which runs out-of-band because
 * a session has to contend for the lock before any migration exists, and the Drizzle declaration,
 * which is what makes the table reconcilable at all. Two implementations of one table is the drift
 * shape this repository treats as a defect waiting to happen.
 *
 * The unit-level parity test next to this one compares COLUMN NAMES, which is cheap and runs without
 * a server — and is not sufficient. A type, a nullability, a primary key or a dialect-specific detail
 * can diverge with the names still matching, and the consequence is not a wrong answer once: it is
 * `nextly migrate` proposing a change to a table that is already correct, on every run, forever.
 *
 * This asks the only question that covers all of those at once — build the table the way a real
 * installation gets it, then let the reconciler compare it against the declaration and assert it has
 * NOTHING to say. Modelled on `schema-events-roundtrip-pg.integration.test.ts`, which guards the same
 * shape for the migration ledger.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";

import { getPgDrizzleKit } from "../../../database/drizzle-kit-lazy";
import { getMigrationLockDdl } from "../../../domains/field-groups/migration/session";
import { nextlyFieldGroupLock } from "../postgres";

const TEST_DB_URL =
  process.env.TEST_POSTGRES_URL ?? process.env.TEST_DATABASE_URL ?? "";

const LOCK_TABLE = "nextly_field_group_lock";

const canConnect = async (): Promise<boolean> => {
  if (!TEST_DB_URL) return false;
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await pool.end();
  }
};

describe("nextly_field_group_lock declared-as-managed (postgres)", async () => {
  if (!(await canConnect())) {
    it.skip("Skipping: Test PostgreSQL not available", () => {});
    return;
  }

  it("bootstrap-created, claimed lock round-trips with no churn", async () => {
    const pool = new Pool({ connectionString: TEST_DB_URL });
    const db = drizzle({ client: pool });

    // Built exactly as a session builds it, and then HELD: a claimed row is the state a reconcile is
    // most likely to meet in the field, and an empty table would not exercise the column's
    // nullability the way an occupied one does.
    await pool.query(`DROP TABLE IF EXISTS "${LOCK_TABLE}" CASCADE;`);
    for (const statement of getMigrationLockDdl("postgresql")) {
      await pool.query(statement);
    }
    await pool.query(
      `INSERT INTO "${LOCK_TABLE}" (id, owner) VALUES ($1, $2)`,
      [1, "field-group-migration#round-trip"]
    );

    const kit = await getPgDrizzleKit();
    const result = await kit.pushSchema({ nextlyFieldGroupLock }, db, {
      schemas: ["public"],
      tables: [LOCK_TABLE],
    });

    await pool.query(`DROP TABLE IF EXISTS "${LOCK_TABLE}" CASCADE;`);
    await pool.end();

    // Scoped to statements naming the lock, so unrelated objects in a shared test database cannot
    // fail this. On a clean database the list is empty either way.
    const churn = result.sqlStatements.filter(s => s.includes(LOCK_TABLE));
    expect(churn).toEqual([]);

    const hints = result.hints.filter(h =>
      `${h.hint} ${h.statement ?? ""}`.includes(LOCK_TABLE)
    );
    expect(hints).toEqual([]);
  });
});
