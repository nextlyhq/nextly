/**
 * A current database that still carries `access_rules` upgrades cleanly, and
 * the boot reconcile reports the column instead of dropping it.
 *
 * This is the upgrade this release supports: an installation on the current
 * core schema whose only difference is the column the stored access rules used
 * to live in. The three properties that make it safe are asserted together,
 * because each one alone is satisfied by an outcome that is not safe:
 *
 *   - it does not throw          — but a boot that degraded also does not throw
 *   - it does not degrade        — but a degraded boot applies nothing, which
 *                                  looks identical to having nothing to do
 *   - the column is still there  — but a push that never ran leaves it there too
 *
 * So the run is required to have SEEN the drop and refused it: the hint naming
 * a blocked destructive statement is what separates "the guard held" from "the
 * guard never looked".
 *
 * Runs on every dialect with a database in this run — SQLite always, Postgres
 * and MySQL when their URL is set — because drizzle-kit's push is a different
 * implementation per dialect, and so is the statement text the destructive
 * guard matches on. A property proven on SQLite alone says nothing about
 * whether Postgres pairs the drop with a rename and crashes. Built from the
 * canonical definitions rather than a hand-written fixture: a fixture would
 * state the schema a second time and drift from the one the reconcile
 * compares against, which is the entire failure mode under test.
 *
 * (`upgrade-sim-045.integration.test.ts` covers the older 0.45 starting point
 * and is skipped; its header states why and what restores it.)
 */
import { describe, expect, it } from "vitest";

import {
  availableDialects,
  buildCurrentCoreSchema,
  withFreshDatabase,
} from "../../../__tests__/helpers/fresh-database";
import { getDialectTablesForPush } from "../../../database/index";
import { freshPushSchema } from "../pipeline/fresh-push";

const REGISTRY_TABLES = ["dynamic_collections", "dynamic_singles"] as const;

describe.each(availableDialects())(
  "upgrading a current database that still holds access_rules (%s)",
  dialect => {
    it("keeps the column, blocks the drop, and does not degrade", async () => {
      await withFreshDatabase(
        dialect,
        "nextly_access_rules_up",
        async fresh => {
          // Build the database at the CURRENT schema, the way a fresh install is
          // created, so the ONLY difference from desired is the legacy column.
          await buildCurrentCoreSchema(fresh);

          // What an installation from before the removal still has.
          for (const table of REGISTRY_TABLES) {
            await fresh.exec(
              `ALTER TABLE ${table} ADD COLUMN access_rules text`
            );
          }

          // The precondition, asserted rather than assumed: a baseline that
          // failed to build these tables would make every assertion below
          // vacuous.
          for (const table of REGISTRY_TABLES) {
            expect(await fresh.columnsOf(table)).toContain("access_rules");
          }

          const result = await freshPushSchema(
            dialect,
            fresh.db,
            getDialectTablesForPush(dialect, {})
          );

          // The push SAW the drop and refused it. Without this the assertions
          // below hold just as well for a push that never examined the schema.
          const hints = result.hints.map(hint => hint.hint);
          expect(hints.join(" | ")).toContain("blocked destructive statement");

          // It did not fall back to the additive-TABLES-only baseline, which is
          // the outcome that silently stops core columns ever arriving again.
          expect(
            hints.some(hint => hint.includes("rename-resolver crash")),
            `the reconcile degraded, so no column alteration would reach this ` +
              `database on any future upgrade: ${hints.join(" | ")}`
          ).toBe(false);

          // And the column is still there — nothing dropped it behind the
          // operator.
          for (const table of REGISTRY_TABLES) {
            expect(await fresh.columnsOf(table)).toContain("access_rules");
          }
        }
      );
    }, 180_000);
  }
);
