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
import { resolveDataLossConsent } from "./data-loss-consent";

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

  const CONSENT = `dynamic_collections.${COLUMN},dynamic_singles.${COLUMN}`;

  it("`nextly migrate` without consent refuses, naming both columns and the consent that drops them", async () => {
    const applyCore = vi.fn();
    const executeSql = vi.fn();

    const refusal = reconcileCore({
      db: testDb.db,
      dialect: "sqlite",
      introspect: () => Promise.resolve(liveWithAccessRules()),
      applyCore,
      executeSql,
      consent: resolveDataLossConsent({}),
    });

    await expect(refusal).rejects.toMatchObject({
      code: "NEXTLY_CORE_DESTRUCTIVE_REFUSED",
    });
    const message = await refusal.catch(
      (error: { publicMessage: string }) => error.publicMessage
    );
    expect(message).toContain(`dynamic_collections.${COLUMN}`);
    expect(message).toContain(`dynamic_singles.${COLUMN}`);
    expect(message).toContain(`--accept-data-loss=${CONSENT}`);
    // Refused means refused: nothing was applied on the way to the error.
    expect(applyCore).not.toHaveBeenCalled();
    expect(executeSql).not.toHaveBeenCalled();
  });

  it("a strict run with no consent at all names the consent and the deprecated variable", async () => {
    await expect(
      reconcileCore({
        db: testDb.db,
        dialect: "sqlite",
        introspect: () => Promise.resolve(liveWithAccessRules()),
        applyCore: vi.fn(),
      })
    ).rejects.toMatchObject({
      code: "NEXTLY_CORE_DESTRUCTIVE_REFUSED",
      publicMessage: expect.stringMatching(
        new RegExp(
          `column dynamic_collections\\.${COLUMN}: the collections' stored access rules.*--accept-data-loss=${CONSENT} \\(or NEXTLY_ACCEPT_DATA_LOSS=${CONSENT}\\)\\. NEXTLY_ALLOW_CORE_DESTRUCTIVE=1 still works .* deprecated`
        )
      ),
    });
  });

  it.each([
    ["the consent naming both columns", { flag: CONSENT }],
    [
      "the deprecated NEXTLY_ALLOW_CORE_DESTRUCTIVE=1",
      {
        env: { NEXTLY_ALLOW_CORE_DESTRUCTIVE: "1" },
        honours: ["NEXTLY_ALLOW_CORE_DESTRUCTIVE" as const],
      },
    ],
  ])(
    "drops both columns with %s, by Nextly's own statement",
    async (_, given) => {
      const applyCore = vi.fn();
      const executeSql = vi.fn().mockResolvedValue(undefined);

      const result = await reconcileCore({
        db: testDb.db,
        dialect: "sqlite",
        introspect: () => Promise.resolve(liveWithAccessRules()),
        applyCore,
        executeSql,
        consent: resolveDataLossConsent(given),
      });

      expect(result.changed).toBe(true);
      // Nothing else to bring up, so no push; the drops are Nextly's.
      expect(applyCore).not.toHaveBeenCalled();
      expect(executeSql.mock.calls.map(([sql]) => sql as string)).toEqual([
        expect.stringMatching(
          /ALTER TABLE .dynamic_collections. DROP COLUMN .access_rules./
        ),
        expect.stringMatching(
          /ALTER TABLE .dynamic_singles. DROP COLUMN .access_rules./
        ),
      ]);
    }
  );

  it("the development boot keeps both columns and names the consent that drops them", async () => {
    const executeSql = vi.fn();
    const warnings: string[] = [];

    await reconcileCore({
      db: testDb.db,
      dialect: "sqlite",
      introspect: () => Promise.resolve(liveWithAccessRules()),
      applyCore: vi.fn(),
      executeSql,
      allowDestructive: true,
      logger: { warn: line => warnings.push(line) },
    });

    expect(executeSql).not.toHaveBeenCalled();
    expect(warnings.join("\n")).toContain(
      `\`nextly migrate\` drops them with the consent --accept-data-loss=${CONSENT} (or NEXTLY_ACCEPT_DATA_LOSS=${CONSENT})`
    );
  });

  it("hands `upgrade --reconcile-core`'s judge both columns, and a refusal drops nothing", async () => {
    const executeSql = vi.fn();
    const judgeDeletions = vi.fn().mockRejectedValue(new Error("declined"));

    await expect(
      reconcileCore({
        db: testDb.db,
        dialect: "sqlite",
        mode: "dev-loose",
        introspect: () => Promise.resolve(liveWithAccessRules()),
        applyCore: vi.fn(),
        executeSql,
        judgeDeletions,
      })
    ).rejects.toThrow("declined");

    expect(judgeDeletions).toHaveBeenCalledWith([
      expect.objectContaining({
        kind: "column",
        table: "dynamic_collections",
        column: COLUMN,
        core: true,
        reason: expect.stringContaining("stored access rules"),
      }),
      expect.objectContaining({ table: "dynamic_singles", column: COLUMN }),
    ]);
    expect(executeSql).not.toHaveBeenCalled();
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
