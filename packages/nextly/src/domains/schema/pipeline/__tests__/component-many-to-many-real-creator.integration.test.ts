/**
 * A component created through the real creator must reconcile as healthy when it holds a
 * many-to-many.
 *
 * The creator writes the component table; the planner then describes that same table from the
 * registry row and compares. Asking the planner over a table it just described would agree with
 * itself, so this test creates the group through `fieldGroups.create` and only then asks.
 *
 * Self-skips per dialect on the standard rule: SQLite always runs, the servers run when their URL
 * is set, and each dialect gets its own throwaway database.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../plugins/test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

for (const dialect of getConfiguredTestDialects()) {
  describe(`a many-to-many component created by the creator reconciles — ${dialect}`, () => {
    it("reports no repair for the many-to-many column", async () => {
      current = await createTestNextly({ dialect });
      const slug = `m2m_${dialect.slice(0, 2)}`;

      await current.nextly.fieldGroups.create({
        slug,
        label: "Many to many",
        fields: [
          { name: "title", type: "text" },
          {
            name: "tags",
            type: "relationship",
            options: { relationType: "manyToMany", target: "tags" },
          },
        ] as never,
      });

      const { reconcileFieldGroup } = await import(
        "../../../field-groups/services/field-group-reconcile-service"
      );
      const report = await reconcileFieldGroup({
        registry: current.getService("fieldGroupRegistryService"),
        adapter: current.adapter,
        logger: current.getService("logger"),
        slug,
      });

      expect(report.repaired.map(r => `${r.fieldName}.${r.attribute}`)).toEqual(
        []
      );
      expect(report.removed.map(r => r.fieldName)).toEqual([]);
      expect(report.unchanged).toBe(true);
    });
  });
}
