/**
 * `nextly upgrade --reconcile-core --dry-run` names what the reconcile would
 * do and changes nothing, on every dialect, and the real run does exactly
 * that under the consent.
 *
 * Behind the reconciler's back, a core index is dropped and a column added to
 * a core table. The dry run names the exact statement the push would run
 * (restoring the index) and the column as a deletion: the push carries it, so
 * it is not among the statements, and only Nextly's own drop, under the
 * data-loss consent, removes it. Where nobody can be asked and no consent
 * covers it, the dry run names the refusal and the consent; and it leaves the
 * table as it found it. The real reconcile with that consent runs exactly the
 * push statements the dry run named, then drops the column.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { reconcileCore } from "../../../domains/schema/migrate/core-reconcile";
import { resolveDataLossConsent } from "../../../domains/schema/migrate/data-loss-consent";
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

    it("names the push's statements and the column it deletes, refuses without consent, and changes nothing", async () => {
      const none = resolveDataLossConsent({});
      // The control: a fresh install's core schema needs nothing.
      const clean = await previewReconcileCore({
        adapter: adapter(),
        interactive: false,
        consent: none,
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
        consent: none,
        // A database whose history the build holds: nothing to refuse.
        checkAppHistory: () => Promise.resolve(),
      });
      const statements = plan.changes
        .filter(c => c.action === "run")
        .map(c => c.target);
      expect(statements.join("\n")).toContain(INDEX);
      expect(statements.join("\n")).not.toContain(EXTRA);
      expect(
        plan.changes
          .filter(c => c.action === "remove")
          .map(c => c.target)
          .join("\n")
      ).toContain(`${TABLE}.${EXTRA}`);
      // Nobody can be asked and no consent covers the column: the real run
      // refuses, and the dry run says so with the consent that covers it.
      expect((plan.refusals ?? []).join("\n")).toContain(
        `--accept-data-loss=${TABLE}.${EXTRA}`
      );

      // A consent naming other targets is refused even at a terminal, as the
      // real run refuses it: nobody is asked about what it leaves out.
      const elsewhere = await previewReconcileCore({
        adapter: adapter(),
        interactive: true,
        consent: resolveDataLossConsent({ flag: "users.nothing_here" }),
        checkAppHistory: () => Promise.resolve(),
      });
      expect((elsewhere.refusals ?? []).join("\n")).toContain(
        `--accept-data-loss=${TABLE}.${EXTRA}`
      );
      // With no consent at a terminal, a real run asks: no refusal.
      const asked = await previewReconcileCore({
        adapter: adapter(),
        interactive: true,
        consent: none,
        checkAppHistory: () => Promise.resolve(),
      });
      expect(asked.refusals ?? []).toEqual([]);

      expect(await table()).toEqual(before);

      // The real reconcile with that consent runs exactly the statements the
      // dry run named, then drops the column itself.
      const executed: string[] = [];
      await runReconcileCore(
        {
          adapter: adapter(),
          consent: resolveDataLossConsent({ flag: `${TABLE}.${EXTRA}` }),
          interactive: false,
          // A database whose history the build holds: nothing to refuse.
          checkAppHistory: () => Promise.resolve(),
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
      expect(executed).toEqual(statements);
      const after = await table();
      expect(after.indexes).toContain(INDEX);
      expect(after.columns).not.toContain(EXTRA);
    });
  }
);
