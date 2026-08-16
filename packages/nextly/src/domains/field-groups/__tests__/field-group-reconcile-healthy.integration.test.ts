/**
 * A HEALTHY field group must reconcile to "nothing to repair", on every dialect and every field type.
 *
 * ## Why this test is the boundary rather than one more case
 *
 * The planner decides whether a stored definition still describes its tables. Every attribute it
 * compares — physical type, nullability, indexes, placement — is an independent chance to disagree
 * with the code that ACTUALLY creates those tables (`FieldGroupSchemaService`), and each such
 * disagreement is a false "this group is damaged" on a group that is perfectly fine. That failure
 * is worse than a missed repair: it refuses the one operation an operator runs to get out of
 * trouble.
 *
 * Reviewing attribute-by-attribute cannot catch it, because the mistake is always a spelling the
 * reviewer also believes. The measurement that catches it is this one: create a group through the
 * real creator, introspect the real tables, and require the planner to report NO changes and NO
 * blockers. Anything it reports here is by construction false, because nothing has drifted.
 *
 * 🔴 The types the creator emits are NOT what the column descriptor reports, which is exactly how
 * this class of defect arises. Measured on live databases: a `date` field is `datetime` on MySQL and
 * `timestamp` on PostgreSQL, while the descriptor answers `timestamp` for both; relations are `UUID`
 * on PostgreSQL and `VARCHAR(36)` on MySQL while the descriptor answers `text`. A comparison built
 * against the descriptor therefore reports drift on healthy groups, and only a live database says so.
 *
 * Self-skips per dialect on the standard rule: SQLite always runs, the servers run when their URL
 * is set, and each dialect gets its own throwaway database.
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

/**
 * One field per storage shape the creator can emit, because the defect is per-shape.
 *
 * Deliberately includes the pairs that collapse to one physical column — `text`/`email`/`textarea`
 * all land on text-like storage — since preserving the DECLARED type across a reconcile is the
 * property the whole operation exists to protect.
 */
const EVERY_SHAPE = [
  { name: "a_text", type: "text" },
  { name: "a_email", type: "email" },
  { name: "a_textarea", type: "textarea" },
  { name: "a_number", type: "number" },
  { name: "a_checkbox", type: "checkbox" },
  { name: "a_date", type: "date" },
  { name: "a_json", type: "json" },
];

for (const dialect of getConfiguredTestDialects()) {
  describe(`a healthy field group reconciles to no-op — ${dialect}`, () => {
    it("reports no changes and no blockers for every field shape", async () => {
      current = await createTestNextly({ dialect });
      const slug = `healthy_${dialect.slice(0, 2)}`;

      await current.nextly.fieldGroups.create({
        slug,
        label: "Healthy",
        fields: EVERY_SHAPE,
      });

      const { reconcileFieldGroup } = await import(
        "../services/field-group-reconcile-service"
      );
      const report = await reconcileFieldGroup({
        registry: current.getService("fieldGroupRegistryService"),
        adapter: current.adapter,
        logger: current.getService("logger"),
        slug,
      });

      // 🔴 Asserted by IDENTITY, not by count. A bare `unchanged === true` would hide WHICH field
      // the planner misread, and the field name is the whole diagnostic when this fails.
      expect(report.removed.map(r => r.fieldName)).toEqual([]);
      expect(report.repaired.map(r => `${r.fieldName}.${r.attribute}`)).toEqual(
        []
      );
      expect(report.adopted.map(a => a.fieldName)).toEqual([]);
      expect(report.unchanged).toBe(true);
    });

    // 🔴 WHAT THIS FILE DOES NOT ESTABLISH: the LOCALIZED case. A group whose translatable columns
    // live in the `_locales` companion is a separate chance for the planner to disagree with the
    // creator — the companion's columns are rendered by a different path (`fieldToLocalizedColumnSpec`
    // + `ddlType`) than the main table's. It is absent here because `fieldGroups.create()` takes no
    // `localized` argument and enabling it afterwards is gated on app-level localization config the
    // harness does not declare; a fixture that created the row without moving the columns would
    // never reach the mechanism, and would pass while proving nothing. Stated rather than faked,
    // and the expectation map covers the companion so the check itself is wired for it.
  });
}
