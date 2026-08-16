/**
 * The code-sync recovery path must actually WRITE its repair.
 *
 * A code-managed field group is LOCKED, and a locked row marked `diverged` is refused from both
 * directions — `assertNotDiverged` blocks the sync that would correct it, and the lock check blocks
 * a human-initiated reconcile. `fromCode` is the single way out: the sync itself asks for the
 * repair, holding the config file that IS the definition.
 *
 * 🔴 What makes this file necessary rather than redundant: every other test of that path asserts
 * the CALL — that the sync invokes reconcile — and a call that reaches the database and writes
 * nothing satisfies all of them. The write is the whole point of the recovery, and it crosses two
 * guards that read the same row for different reasons (the lock check before the plan, the
 * conditional predicate inside the write). A change to either can strand this path while every
 * existing assertion stays green, which is exactly what happened once: adding `locked` to the
 * conditional predicate left the lock check passing and the write matching zero rows, so the
 * recovery raised "run the reconcile again" on a row that could never satisfy it.
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
  describe(`the code-sync reconcile recovery — ${dialect}`, () => {
    const slug = `fgfc_${dialect.slice(0, 2)}`;

    /** A LOCKED, `diverged` group — the state the recovery exists to clear. */
    async function seedLockedDiverged() {
      current = await createTestNextly({ dialect });
      const registry = current.getService("fieldGroupRegistryService");
      await current.nextly.fieldGroups.create({
        slug,
        label: "Code managed",
        fields: FIELDS,
      });
      // Claimed by code and marked, exactly as a sync whose companion DDL committed and whose row
      // write failed leaves it. `source: "code"` because a UI caller cannot set either.
      await registry.updateComponent(
        slug,
        { locked: true, migrationStatus: "diverged" },
        { source: "code" }
      );
      return { registry, row: await registry.getComponent(slug) };
    }

    it("clears the mark on a locked group and persists the repair", async () => {
      const { registry, row } = await seedLockedDiverged();
      expect(row.locked).toBe(true);
      expect(row.migrationStatus).toBe("diverged");

      const { reconcileFieldGroup } = await import(
        "../services/field-group-reconcile-service"
      );
      const report = await reconcileFieldGroup({
        registry,
        adapter: current!.adapter,
        logger: current!.getService("logger"),
        slug,
        fromCode: true,
      });

      // The tables are healthy, so nothing about the FIELDS needed repairing — the standing mark
      // is the thing that was wrong, and clearing it is a write.
      expect(report.slug).toBe(slug);

      // 🔴 Asserted on the ROW, not on the report. A path that returned a plausible report while
      // writing nothing is precisely the failure this file exists to catch, and the report alone
      // cannot separate the two.
      const after = await registry.getComponent(slug);
      expect(after.migrationStatus).toBe("synced");
      expect(after.schemaVersion).toBe(row.schemaVersion + 1);
      // Still code-managed: the recovery repairs the record, it does not release ownership.
      expect(after.locked).toBe(true);
    });

    // The control that keeps `fromCode` from becoming a general bypass: without it the same call
    // must still be refused, because a human-initiated repair of a code-managed row would be
    // overwritten by the next sync and the config file is what needs fixing.
    it("still refuses a locked group when the caller is not the code sync", async () => {
      const { registry } = await seedLockedDiverged();

      const { reconcileFieldGroup } = await import(
        "../services/field-group-reconcile-service"
      );

      await expect(
        reconcileFieldGroup({
          registry,
          adapter: current!.adapter,
          logger: current!.getService("logger"),
          slug,
        })
      ).rejects.toMatchObject({ code: "CONFLICT" });

      // And the refusal wrote nothing.
      const after = await registry.getComponent(slug);
      expect(after.migrationStatus).toBe("diverged");
    });
  });
}
