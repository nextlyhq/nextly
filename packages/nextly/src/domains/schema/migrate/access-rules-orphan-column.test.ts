/**
 * An existing database keeps its `access_rules` column, and the schema entry
 * points report it by name rather than dropping it behind the operator's back.
 *
 * The stored per-operation access rules were removed, and with them the column
 * that held them. A NEW database never gets it — it is gone from the Drizzle
 * definitions and from the CREATE TABLE DDL. An EXISTING database still has it,
 * holding whatever rules were configured, and no boot may quietly `DROP COLUMN`
 * on a core table to tidy that away.
 *
 * So the column becomes an ORPHAN: present in the database, absent from the
 * desired schema. The three entry points that meet it answer differently, and
 * each answer is asserted here because each is a decision:
 *
 *   `nextly migrate`  — REFUSES, and its reason names the column, so the
 *                       operator learns the column is there and chooses.
 *   `db:sync` / HMR   — proceeds with the operator's confirmation, which the
 *                       dev flow supplies; a developer is never silently
 *                       dropped into a destructive core change.
 *   an override       — `NEXTLY_ALLOW_CORE_DESTRUCTIVE=1` is how the drop
 *                       actually happens, which is what makes the column
 *                       removable rather than permanent.
 *
 * The live snapshot is injected rather than introspected from a real database:
 * the property is what the DIFFER and the CLASSIFIER do with an extra column,
 * and a snapshot states that in one line where a fixture database states it in
 * a hundred and brings its own unrelated drift along.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

import { createTestDb, type TestDb } from "../../../__tests__/fixtures/db";
import { getCoreSchema } from "../../../schemas";
import { classifyForMode } from "../pipeline/classifier/modes";
import { diffSnapshots } from "../pipeline/diff/diff";
import type { NextlySchemaSnapshot } from "../pipeline/diff/types";

import { reconcileCore } from "./core-reconcile";

const COLUMN = "access_rules";

describe("the access_rules column on a database that predates its removal", () => {
  let testDb: TestDb;
  const desired = getCoreSchema("sqlite");

  beforeEach(async () => {
    testDb = await createTestDb();
  });

  /**
   * The desired core schema, plus `access_rules` back on the two registry
   * tables — which is exactly what an installation from before the removal
   * holds. Nothing else differs, so any operation the diff reports is about
   * this column.
   */
  function liveWithAccessRules(): NextlySchemaSnapshot {
    return {
      tables: desired.tables.map(table =>
        table.name === "dynamic_collections" || table.name === "dynamic_singles"
          ? {
              ...table,
              columns: [
                ...table.columns,
                { name: COLUMN, type: "text", nullable: true },
              ],
            }
          : table
      ),
    };
  }

  it("is the only thing the differ finds, and it finds it on both tables", () => {
    const ops = diffSnapshots(liveWithAccessRules(), desired);

    // Named rather than counted. A diff that dropped some OTHER column would
    // satisfy a count, and would be a far worse defect than the one guarded.
    expect(
      ops.map(op =>
        op.type === "drop_column"
          ? `${op.type} ${op.tableName}.${op.columnName}`
          : op.type
      )
    ).toEqual([
      `drop_column dynamic_collections.${COLUMN}`,
      `drop_column dynamic_singles.${COLUMN}`,
    ]);
  });

  it("`nextly migrate` refuses, and the reason names the column", async () => {
    const applyCore = vi.fn();

    await expect(
      reconcileCore({
        db: testDb.db,
        dialect: "sqlite",
        introspect: () => Promise.resolve(liveWithAccessRules()),
        applyCore,
        allowDestructive: false,
      })
    ).rejects.toMatchObject({
      code: "NEXTLY_CORE_DESTRUCTIVE_REFUSED",
      // The operator has to be able to act on this, which means reading which
      // column is in question out of the message itself.
      publicMessage: expect.stringContaining(
        `drops column 'dynamic_collections.${COLUMN}'`
      ),
    });

    // Refused means refused: nothing was applied on the way to the error.
    expect(applyCore).not.toHaveBeenCalled();
  });

  it("drops it once the operator sets NEXTLY_ALLOW_CORE_DESTRUCTIVE", async () => {
    // The mirror of the refusal, and the reason that one is not enough on its
    // own: a reconcile that refused unconditionally would satisfy it while
    // leaving the column permanently unremovable.
    const applyCore = vi
      .fn()
      .mockResolvedValue({ statementsExecuted: ["ALTER TABLE …"] });

    const result = await reconcileCore({
      db: testDb.db,
      dialect: "sqlite",
      introspect: () => Promise.resolve(liveWithAccessRules()),
      applyCore,
      allowDestructive: true,
    });

    expect(result.changed).toBe(true);
    expect(applyCore).toHaveBeenCalledOnce();
  });

  it("asks the operator to confirm on the dev path rather than deciding", async () => {
    const applyCore = vi.fn();
    const confirmDestructive = vi.fn().mockResolvedValue(false);

    await expect(
      reconcileCore({
        db: testDb.db,
        dialect: "sqlite",
        mode: "dev-loose",
        confirmDestructive,
        introspect: () => Promise.resolve(liveWithAccessRules()),
        applyCore,
      })
    ).rejects.toMatchObject({ code: "NEXTLY_CORE_DESTRUCTIVE_REFUSED" });

    // The column reaches the prompt, so what the operator is agreeing to is
    // legible at the moment they agree to it.
    expect(confirmDestructive).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.stringContaining(`dynamic_collections.${COLUMN}`),
      ])
    );
    expect(applyCore).not.toHaveBeenCalled();
  });

  it("is skipped, never applied, by the additive dev-server pass", () => {
    // `db:sync` and the HMR reload run additively: a dev server must come up
    // against an older database without turning into a data decision.
    const verdict = classifyForMode(
      diffSnapshots(liveWithAccessRules(), desired),
      "sqlite",
      "dev-additive"
    );

    expect(verdict.verdict).toBe("apply");
    if (verdict.verdict !== "apply") return;

    expect(
      verdict.skipped.map(op =>
        op.type === "drop_column" ? `${op.tableName}.${op.columnName}` : op.type
      )
    ).toEqual([`dynamic_collections.${COLUMN}`, `dynamic_singles.${COLUMN}`]);
    expect(verdict.applied).toEqual([]);
  });
});
