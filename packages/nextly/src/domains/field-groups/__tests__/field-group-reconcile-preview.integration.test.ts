/**
 * A reconcile preview must describe the repair WITHOUT performing any part of it, and must
 * describe the repair that will actually run.
 *
 * 🔴 Two failures this file exists to catch, and neither shows up in a report-shape assertion:
 *
 * 1. A preview that writes. The operation reads the registry and the catalog and plans a repair —
 *    every ingredient of the write is in hand, so a preview is one stray call away from being an
 *    apply. Asserted on the ROW, never on the returned object, because a preview that wrote would
 *    return exactly the same object as one that did not.
 *
 * 2. A preview that mispredicts. `plan.unchanged` answers whether the DEFINITION describes the
 *    tables, which is a narrower question than whether applying writes: a group whose every field
 *    matches while its status still reads `diverged` needs a write that `plan.unchanged` does not
 *    predict. A preview deriving "nothing will happen" from the plan reports a quiet apply and
 *    then the version moves. The two answers are computed once and shared, and the stale-marker
 *    case below is what holds them together.
 *
 * The approval pin is the third property: an apply carrying the version a preview reported must
 * refuse once the row has moved, so an operator can never approve one plan and execute another.
 *
 * Self-skips per dialect on the standard rule.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const FIELDS = [
  { name: "heading", type: "text" },
  { name: "weight", type: "number" },
];

for (const dialect of getConfiguredTestDialects()) {
  describe(`the reconcile preview — ${dialect}`, () => {
    const slug = `fgpv_${dialect.slice(0, 2)}`;

    /** A healthy group: its tables and its definition already agree. */
    async function seedHealthy() {
      current = await createTestNextly({ dialect });
      const registry = current.getService("fieldGroupRegistryService");
      await current.nextly.fieldGroups.create({
        slug,
        label: "Preview subject",
        fields: FIELDS,
      });
      return { registry, row: await registry.getComponent(slug) };
    }

    async function preview(registry: unknown) {
      const { previewFieldGroupReconcile } = await import(
        "../services/field-group-reconcile-service"
      );
      return previewFieldGroupReconcile({
        registry: registry as Parameters<
          typeof previewFieldGroupReconcile
        >[0]["registry"],
        adapter: current!.adapter,
        slug,
      });
    }

    it("changes nothing on the row it describes", async () => {
      const { registry, row } = await seedHealthy();

      const report = await preview(registry);
      expect(report.slug).toBe(slug);
      expect(report.schemaVersion).toBe(row.schemaVersion);

      // 🔴 The row, not the report. A preview that performed the repair would return this same
      // object, so only the stored version and status separate the two outcomes.
      const after = await registry.getComponent(slug);
      expect(after.schemaVersion).toBe(row.schemaVersion);
      expect(after.migrationStatus).toBe(row.migrationStatus);
      expect(after.fields).toEqual(row.fields);
    });

    it("reports no write pending on a group that is genuinely healthy", async () => {
      const { registry, row } = await seedHealthy();

      const report = await preview(registry);
      expect(report.blockers).toEqual([]);
      expect(report.unchanged).toBe(true);
      expect(report.wouldWrite).toBe(false);
      expect(report.staleStatus).toBeUndefined();

      // And the prediction holds: applying really does leave the version where it was.
      const { reconcileFieldGroup } = await import(
        "../services/field-group-reconcile-service"
      );
      await reconcileFieldGroup({
        registry,
        adapter: current!.adapter,
        logger: current!.getService("logger"),
        slug,
      });
      const after = await registry.getComponent(slug);
      expect(after.schemaVersion).toBe(row.schemaVersion);
    });

    it("still reports a pending write when only the STATUS is stale", async () => {
      const { registry, row } = await seedHealthy();
      // The tables and the definition agree; the mark does not. This is the case where the plan
      // and the write decision genuinely differ, and where a preview reading `plan.unchanged`
      // would promise that applying does nothing.
      await registry.updateComponent(
        slug,
        { migrationStatus: "diverged" },
        { source: "code" }
      );

      const report = await preview(registry);
      expect(report.unchanged).toBe(true);
      expect(report.wouldWrite).toBe(true);
      expect(report.staleStatus).toBe("diverged");

      // The prediction is what is under test, so it is checked against the apply rather than
      // asserted on its own: the version MOVES, which `unchanged` alone would have denied.
      const { reconcileFieldGroup } = await import(
        "../services/field-group-reconcile-service"
      );
      await reconcileFieldGroup({
        registry,
        adapter: current!.adapter,
        logger: current!.getService("logger"),
        slug,
        expectedSchemaVersion: report.schemaVersion,
      });
      const after = await registry.getComponent(slug);
      expect(after.migrationStatus).toBe("synced");
      expect(after.schemaVersion).toBeGreaterThan(row.schemaVersion);
    });

    it("refuses an apply whose approved version the row has moved past", async () => {
      const { registry } = await seedHealthy();
      await registry.updateComponent(
        slug,
        { migrationStatus: "diverged" },
        { source: "code" }
      );

      const report = await preview(registry);
      const approved = report.schemaVersion;

      const { reconcileFieldGroup } = await import(
        "../services/field-group-reconcile-service"
      );

      // The row moves between the preview and the approval, by a repair somebody else already
      // ran — the double-submit this pin exists for, where two tabs both hold the same plan.
      //
      // Moved with a reconcile rather than a metadata edit on purpose: `schemaVersion` tracks the
      // SCHEMA, so a label-only update does not advance it. That is the right granularity for this
      // pin (renaming a group cannot invalidate a plan about its columns) and it means a fixture
      // reaching for a label change moves nothing and proves nothing.
      await reconcileFieldGroup({
        registry,
        adapter: current!.adapter,
        logger: current!.getService("logger"),
        slug,
      });
      const moved = await registry.getComponent(slug);
      expect(moved.schemaVersion).toBeGreaterThan(approved);
      await expect(
        reconcileFieldGroup({
          registry,
          adapter: current!.adapter,
          logger: current!.getService("logger"),
          slug,
          expectedSchemaVersion: approved,
        })
      ).rejects.toMatchObject({ code: "CONFLICT" });

      // The refusal wrote nothing — the row is exactly where the earlier repair left it, so the
      // second approval neither re-applied nor bumped the version a second time.
      const after = await registry.getComponent(slug);
      expect(after.schemaVersion).toBe(moved.schemaVersion);
      expect(after.migrationStatus).toBe(moved.migrationStatus);
    });
  });
}
