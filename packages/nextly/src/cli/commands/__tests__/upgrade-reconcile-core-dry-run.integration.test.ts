/**
 * `nextly upgrade --reconcile-core --dry-run` names what the reconcile would
 * do and changes nothing, on every dialect, and the confirmation of a real
 * run asks only about what it will actually do.
 *
 * Behind the reconciler's back, a core index is dropped and a column added to
 * a core table. The dry run names the exact statement the push would run
 * (restoring the index) and names the column's drop as left in place, since
 * the push strips every table or column drop on a core table. With nothing
 * destructive left to make, it names no refusal even where nobody could be
 * asked, and it leaves the table as it found it. The real reconcile asks
 * nobody anything and runs exactly the statements the dry run named. That a
 * confirmation still asks about a destructive change the push does make is
 * held in `core-reconcile.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { reconcileCore } from "../../../domains/schema/migrate/core-reconcile";
import { introspectLiveSnapshot } from "../../../domains/schema/pipeline/diff/introspect-live";
import { freshPushSchema } from "../../../domains/schema/pipeline/fresh-push";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import {
  previewReconcileCore,
  runReconcileCore,
  type UpgradeAdapter,
} from "../upgrade";

const TABLE = "nextly_versions";
const INDEX = "nextly_versions_pending_edits_idx";
const EXTRA = "dry_extra";

describe.each(getConfiguredTestDialects())(
  "nextly upgrade --reconcile-core --dry-run (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;

    beforeEach(async () => {
      t = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
    }, 180_000);

    afterEach(async () => {
      await t?.destroy();
    });

    const adapter = () => t.adapter as unknown as UpgradeAdapter;

    /** The table's columns and indexes, as the reconcile reads them. */
    async function table() {
      const snapshot = await introspectLiveSnapshot(
        t.adapter.getDrizzle(),
        t.adapter.dialect,
        [TABLE]
      );
      const found = snapshot.tables.find(entry => entry.name === TABLE);
      return {
        columns: (found?.columns ?? []).map(c => c.name).sort(),
        indexes: (found?.indexes ?? []).map(i => i.name).sort(),
      };
    }

    it("names the push's statements and what it leaves in place, asks nothing, and changes nothing", async () => {
      // The control: a fresh install's core schema needs nothing.
      const clean = await previewReconcileCore({
        adapter: adapter(),
        interactive: false,
        // A database whose history the build holds: nothing to refuse.
        checkAppHistory: () => Promise.resolve(),
      });
      expect(clean.changes, JSON.stringify(clean)).toEqual([]);

      await t.adapter.executeQuery(
        dialect === "mysql"
          ? `DROP INDEX ${INDEX} ON ${TABLE}`
          : `DROP INDEX "${INDEX}"`
      );
      await t.adapter.executeQuery(
        `ALTER TABLE ${TABLE} ADD COLUMN ${EXTRA} TEXT`
      );
      const before = await table();
      expect(before.indexes).not.toContain(INDEX);
      expect(before.columns).toContain(EXTRA);

      const plan = await previewReconcileCore({
        adapter: adapter(),
        interactive: false,
        // A database whose history the build holds: nothing to refuse.
        checkAppHistory: () => Promise.resolve(),
      });
      const statements = plan.changes.map(c => c.target);
      expect(statements.join("\n")).toContain(INDEX);
      expect(statements.join("\n")).not.toContain(EXTRA);
      expect((plan.notes ?? []).join("\n")).toMatch(
        new RegExp(`Left in place: .*${EXTRA}`)
      );
      // The column's drop is never made, so nothing needs confirming, and a
      // real run with nobody to ask is not refused.
      expect(plan.refusals ?? []).toEqual([]);

      expect(await table()).toEqual(before);

      // The real reconcile asks nothing, and runs exactly the statements the
      // dry run named.
      const questions: string[][] = [];
      const executed: string[] = [];
      await runReconcileCore(
        {
          adapter: adapter(),
          // A database whose history the build holds: nothing to refuse.
          checkAppHistory: () => Promise.resolve(),
          confirmDestructive: async reasons => {
            questions.push(reasons);
            return true;
          },
        },
        {
          reconcileCore: deps =>
            reconcileCore({
              ...deps,
              applyCore: async (d, db, schema) => {
                const result = await freshPushSchema(d, db, schema);
                executed.push(...result.statementsExecuted);
                return result;
              },
            }),
        }
      );
      expect(questions).toEqual([]);
      expect(executed).toEqual(statements);
      const after = await table();
      expect(after.indexes).toContain(INDEX);
      expect(after.columns).toContain(EXTRA);
    });
  }
);
