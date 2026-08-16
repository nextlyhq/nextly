import { describe, expect, it } from "vitest";

import { buildDesiredTableFromComponentFields } from "../../../schema/pipeline/diff/build-from-fields";
import type { TableSpec } from "../../../schema/pipeline/diff/types";
import {
  planFieldGroupReconcile,
  type ReconcilableField,
  type ReconcileTable,
} from "../reconcile-field-group-plan";

const TABLE = "comp_hero";
const COMPANION = "comp_hero_locales";
const DIALECT = "postgresql" as const;

/**
 * Live-table fixtures are built by the SAME builder the planner derives its system-column set
 * from, so a system column the generator gains tomorrow is present on both sides of the
 * comparison automatically — hand-listing columns here would re-introduce the drift the planner
 * exists to repair.
 */
function liveTableFor(
  fields: ReconcilableField[],
  options: { localized?: boolean } = {}
): TableSpec {
  return buildDesiredTableFromComponentFields(TABLE, fields, DIALECT, {
    builtBy: "fieldGroup",
    ...(options.localized !== undefined
      ? { localized: options.localized }
      : {}),
  });
}

/**
 * A companion holding the given user columns beside its structural pair.
 *
 * The structural pair carries `primaryKey`, because the real companion DDL declares
 * `PRIMARY KEY (_parent, _locale)` and introspection reports it per column on all three dialects.
 * A fixture that omitted it would model a table the generator never produces.
 */
function companionWith(
  columns: Array<{ name: string; type?: string }>
): TableSpec {
  return {
    name: COMPANION,
    columns: [
      { name: "_parent", type: "text", nullable: false, primaryKey: true },
      { name: "_locale", type: "varchar", nullable: false, primaryKey: true },
      ...columns.map(c => ({
        name: c.name,
        type: c.type ?? "text",
        nullable: true,
      })),
    ],
  };
}

function plan(args: {
  storedFields: ReconcilableField[];
  liveMain: TableSpec;
  liveCompanion?: TableSpec | null;
  /** Defaults to false — the flag the row of a never-localized group records. */
  storedLocalized?: boolean;
  /**
   * What the table builders would write, asked per (field, table). Absent means the type check has
   * nothing to compare and must stay silent.
   */
  expectedColumnType?: (
    field: ReconcilableField,
    table: ReconcileTable
  ) => string | undefined;
  /** The builder's DEFAULT for a column; `known: false` means the check must stay silent. */
  expectedColumnDefault?: (
    field: ReconcilableField,
    table: ReconcileTable
  ) => { known: boolean; value?: string };
}) {
  return planFieldGroupReconcile({
    storedFields: args.storedFields,
    storedLocalized: args.storedLocalized ?? false,
    dialect: DIALECT,
    tableName: TABLE,
    liveMain: args.liveMain,
    liveCompanion: args.liveCompanion ?? null,
    ...(args.expectedColumnType
      ? { expectedColumnType: args.expectedColumnType }
      : {}),
    ...(args.expectedColumnDefault
      ? { expectedColumnDefault: args.expectedColumnDefault }
      : {}),
  });
}

describe("planFieldGroupReconcile", () => {
  it("reports an already-honest definition as unchanged and keeps every field identical", () => {
    const stored: ReconcilableField[] = [
      { name: "title", type: "text", required: true },
      { name: "contact", type: "email" },
    ];
    const result = plan({
      storedFields: stored,
      liveMain: liveTableFor(stored),
    });

    expect(result.unchanged).toBe(true);
    expect(result.fields).toEqual(stored);
    expect(result.removed).toEqual([]);
    expect(result.repaired).toEqual([]);
    expect(result.adopted).toEqual([]);
  });

  it("keeps the declared LOGICAL type when repairing a physical attribute", () => {
    // `email` and `text` are one physical `text` column, so a rebuild from introspection would
    // downgrade the type. The repair must touch only the attribute that drifted.
    const stored: ReconcilableField[] = [
      { name: "contact", type: "email", required: true },
    ];
    // The live column exists but is nullable: the failed edit never applied the NOT NULL.
    const live = liveTableFor([{ name: "contact", type: "email" }]);

    const result = plan({ storedFields: stored, liveMain: live });

    expect(result.unchanged).toBe(false);
    expect(result.fields).toEqual([
      { name: "contact", type: "email", required: false },
    ]);
    expect(result.repaired).toEqual([
      {
        fieldName: "contact",
        columnName: "contact",
        table: "main",
        attribute: "required",
        from: true,
        to: false,
      },
    ]);
  });

  it("removes a field whose column vanished and reports it by identity", () => {
    const stored: ReconcilableField[] = [
      { name: "title", type: "text" },
      { name: "subtitle", type: "text" },
    ];
    const live = liveTableFor([{ name: "title", type: "text" }]);

    const result = plan({ storedFields: stored, liveMain: live });

    expect(result.fields.map(f => f.name)).toEqual(["title"]);
    expect(result.removed).toEqual([
      { fieldName: "subtitle", columnName: "subtitle" },
    ]);
  });

  it("adopts an unknown live column with a guessed type, flagged as a guess", () => {
    const live = liveTableFor([{ name: "title", type: "text" }]);
    live.columns.push({ name: "mystery_count", type: "int4", nullable: false });

    const result = plan({
      storedFields: [{ name: "title", type: "text" }],
      liveMain: live,
    });

    expect(result.adopted).toEqual([
      {
        fieldName: "mystery_count",
        columnName: "mystery_count",
        table: "main",
        liveType: "int4",
        guessedType: "number",
      },
    ]);
    const adopted = result.fields.find(f => f.name === "mystery_count");
    expect(adopted).toMatchObject({
      type: "number",
      required: true,
    });
  });

  it("never adopts a system column, including the probed discriminator spelling", () => {
    const stored: ReconcilableField[] = [{ name: "title", type: "text" }];
    // A table the storage migration moved carries the new discriminator name; naming it via
    // `typeColumn` is what keeps it out of the adoption list.
    const live = buildDesiredTableFromComponentFields(TABLE, stored, DIALECT, {
      builtBy: "fieldGroup",
      typeColumn: "_field_group_type",
    });

    const result = planFieldGroupReconcile({
      storedFields: stored,
      storedLocalized: false,
      dialect: DIALECT,
      tableName: TABLE,
      liveMain: live,
      liveCompanion: null,
      typeColumn: "_field_group_type",
    });

    expect(result.adopted).toEqual([]);
    expect(result.unchanged).toBe(true);
  });

  it("derives localized from the companion holding a user column, never from a flag", () => {
    const stored: ReconcilableField[] = [
      { name: "title", type: "text", localized: true },
    ];
    const result = plan({
      storedFields: stored,
      liveMain: liveTableFor(stored, { localized: true }),
      liveCompanion: companionWith([{ name: "title" }]),
      storedLocalized: true,
    });

    expect(result.localized).toBe(true);
    expect(result.unchanged).toBe(true);
  });

  it("reads a companion holding only structural columns as not localized", () => {
    const stored: ReconcilableField[] = [{ name: "title", type: "text" }];
    const result = plan({
      storedFields: stored,
      liveMain: liveTableFor(stored),
      liveCompanion: companionWith([]),
    });

    expect(result.localized).toBe(false);
  });

  it("does not repair required from a companion column's nullability", () => {
    // Companion columns are created nullable whatever the field declares, so their nullability is
    // structural rather than evidence — a required localized field must survive untouched.
    const stored: ReconcilableField[] = [
      { name: "title", type: "text", localized: true, required: true },
    ];
    const result = plan({
      storedFields: stored,
      liveMain: liveTableFor(stored, { localized: true }),
      liveCompanion: companionWith([{ name: "title" }]),
      storedLocalized: true,
    });

    expect(result.repaired).toEqual([]);
    expect(result.fields).toEqual(stored);
  });

  it("corrects a declared unique the live table no longer backs, when indexes are tracked", () => {
    const stored: ReconcilableField[] = [
      { name: "slug_field", type: "text", unique: true },
    ];
    const live = liveTableFor([{ name: "slug_field", type: "text" }]);
    // Tracked-and-empty is a statement about the table; undefined is a statement about the
    // snapshot, covered by the test below.
    live.indexes = [];

    const result = plan({ storedFields: stored, liveMain: live });

    expect(result.repaired).toEqual([
      {
        fieldName: "slug_field",
        columnName: "slug_field",
        table: "main",
        attribute: "unique",
        from: true,
        to: false,
      },
    ]);
    expect(result.fields[0]).toMatchObject({ type: "text", unique: false });
  });

  it("leaves declared indexes alone when the snapshot tracked no index data", () => {
    const stored: ReconcilableField[] = [
      { name: "slug_field", type: "text", unique: true },
    ];
    const live = liveTableFor([{ name: "slug_field", type: "text" }]);
    delete live.indexes;

    const result = plan({ storedFields: stored, liveMain: live });

    expect(result.repaired).toEqual([]);
    expect(result.fields).toEqual(stored);
  });

  it("keeps a layout-only field no column can testify about", () => {
    const stored: ReconcilableField[] = [
      { name: "title", type: "text" },
      // `component` fields produce no column on this table: instances live in the child table.
      { name: "cta", type: "component" },
    ];
    const result = plan({
      storedFields: stored,
      liveMain: liveTableFor([{ name: "title", type: "text" }]),
    });

    expect(result.fields.map(f => f.name)).toContain("cta");
    expect(result.removed).toEqual([]);
  });

  // The primary divergence this operation repairs: a localization enable whose DDL landed and
  // whose row write failed differs from a healthy group ONLY in the flag. Field-list comparison
  // alone reads that as unchanged, and the caller then skips the one write the repair exists for.
  it("treats flag drift alone as a change", () => {
    const stored: ReconcilableField[] = [
      { name: "title", type: "text", localized: true },
    ];
    const result = plan({
      storedFields: stored,
      liveMain: liveTableFor(stored, { localized: true }),
      liveCompanion: companionWith([{ name: "title" }]),
      // The row still says non-localized: the enable transition committed, the write did not.
      storedLocalized: false,
    });

    expect(result.localized).toBe(true);
    expect(result.unchanged).toBe(false);
    // And nothing else invented: the flag IS the whole repair.
    expect(result.removed).toEqual([]);
    expect(result.repaired).toEqual([]);
    expect(result.adopted).toEqual([]);
  });

  // A half-applied type change leaves a live column under a columnless field's own name. Keeping
  // the columnless declaration AND adopting the column would persist two fields with one name and
  // mark the ambiguity synced; the columnless field gives way, as a reported removal.
  it("replaces a columnless field whose name a live column now occupies", () => {
    const stored: ReconcilableField[] = [
      { name: "title", type: "text" },
      { name: "cta", type: "component" },
    ];
    const live = liveTableFor([{ name: "title", type: "text" }]);
    live.columns.push({ name: "cta", type: "text", nullable: true });

    const result = plan({ storedFields: stored, liveMain: live });

    expect(result.fields.filter(f => f.name === "cta")).toHaveLength(1);
    expect(result.fields.find(f => f.name === "cta")).toMatchObject({
      type: "text",
    });
    expect(result.removed).toEqual([{ fieldName: "cta", columnName: "cta" }]);
    expect(result.adopted).toEqual([
      expect.objectContaining({ fieldName: "cta", table: "main" }),
    ]);
  });

  // In a localized group a text-like field with NO flag defaults to translatable, which would
  // re-home a column the planner just found on the MAIN table. Silence is not neutral there, so
  // main-table adoptions carry an explicit false.
  it("pins a main-table adoption of a localized group to the main table", () => {
    const stored: ReconcilableField[] = [
      { name: "title", type: "text", localized: true },
    ];
    const live = liveTableFor(stored, { localized: true });
    live.columns.push({ name: "mystery_note", type: "text", nullable: true });

    const result = plan({
      storedFields: stored,
      liveMain: live,
      liveCompanion: companionWith([{ name: "title" }]),
      storedLocalized: true,
    });

    expect(result.fields.find(f => f.name === "mystery_note")).toMatchObject({
      type: "text",
      localized: false,
    });
  });

  // 🔴 The finding that would have DESTROYED authored meaning. Toggling one field's `localized`
  // moves its column between tables; searching only the table the stale flag implies reports the
  // field as removed and re-adopts its column as a minimal guess, discarding the logical type and
  // every authored option. Located where the column actually is, the field survives intact.
  it("keeps a field whose column moved between tables, correcting only its placement", () => {
    const stored: ReconcilableField[] = [
      { name: "title", type: "text", localized: true },
      // Declared as living on the MAIN table, but the apply moved it to the companion.
      { name: "contact", type: "email", localized: false, required: true },
    ];
    const result = plan({
      storedFields: stored,
      liveMain: liveTableFor(
        [{ name: "title", type: "text", localized: true }],
        {
          localized: true,
        }
      ),
      liveCompanion: companionWith([{ name: "title" }, { name: "contact" }]),
      storedLocalized: true,
    });

    const contact = result.fields.find(f => f.name === "contact");
    // The authored LOGICAL type survives — an adoption would have guessed `text`.
    expect(contact).toMatchObject({ type: "email", localized: true });
    expect(result.removed).toEqual([]);
    expect(result.adopted).toEqual([]);
    expect(result.repaired).toContainEqual({
      fieldName: "contact",
      columnName: "contact",
      table: "companion",
      attribute: "localized",
      from: false,
      to: true,
    });
  });

  it("refuses when one column exists on both tables", () => {
    const stored: ReconcilableField[] = [
      { name: "title", type: "text", localized: true },
    ];
    // A localization enable that seeded the companion without finishing the main-table drops.
    const live = liveTableFor([{ name: "title", type: "text" }]);
    const result = plan({
      storedFields: stored,
      liveMain: live,
      liveCompanion: companionWith([{ name: "title" }]),
      storedLocalized: true,
    });

    expect(result.blockers).toEqual([
      expect.objectContaining({
        fieldName: "title",
        kind: "column-on-both-tables",
      }),
    ]);
  });

  it("refuses when a column's physical type no longer matches its declared field", () => {
    const stored: ReconcilableField[] = [{ name: "weight", type: "number" }];
    // The apply changed the column to text and then failed its registry write.
    const live = liveTableFor([{ name: "weight", type: "number" }]);
    const col = live.columns.find(c => c.name === "weight");
    if (col) col.type = "text";

    const result = plan({
      storedFields: stored,
      liveMain: live,
      // 🔴 The expectation comes from the table builders, so the test must supply one — without it
      // the check has nothing to compare against and correctly stays silent. Supplying nothing here
      // is what made this case inert when the comparison moved off the column descriptor, and the
      // suite caught it; this is the check's real input rather than scaffolding.
      expectedColumnType: () => "int4",
    });

    expect(result.blockers).toEqual([
      expect.objectContaining({
        fieldName: "weight",
        kind: "physical-type-changed",
      }),
    ]);
  });

  /**
   * The two tables are built by different code and spell the same field differently, so the type
   * check must ask about the table the column was FOUND in.
   *
   * The case that makes this load-bearing is the one below: the column has moved to the companion
   * while the stored flag still says the group is not localized. That disagreement is the primary
   * divergence this operation repairs, so resolving the expectation from the stored flag would
   * report drift on precisely the input reconcile exists to fix — and would do it while the column
   * is perfectly healthy.
   *
   * Asserted on the ARGUMENTS the check actually passes rather than only on the absence of a
   * blocker: a planner that stopped consulting the expectation at all would also produce no
   * blocker, and this must not pass for that reason.
   */
  it("asks for the expected type of the table the column was found in", () => {
    const stored: ReconcilableField[] = [{ name: "contact", type: "email" }];
    const live = liveTableFor([]);
    const companion = companionWith([{ name: "contact", type: "text" }]);

    const asked: Array<{ field: string; table: ReconcileTable }> = [];
    const result = plan({
      storedFields: stored,
      liveMain: live,
      liveCompanion: companion,
      // The real spellings this pair produces on PostgreSQL: the main table's builder gives an
      // `email` a length-capped varchar, the companion's builder gives it unbounded text. Asking
      // about the wrong table therefore compares `varchar` against a live `text` and blocks.
      storedLocalized: false,
      expectedColumnType: (field, table) => {
        asked.push({ field: field.name, table });
        return table === "companion" ? "TEXT" : "VARCHAR(255)";
      },
    });

    expect(asked).toEqual([{ field: "contact", table: "companion" }]);
    expect(result.blockers).toEqual([]);
  });

  /**
   * The DEFAULT is physical, and drifts exactly as the type does.
   *
   * Three-valued on purpose: the removal case below is the one a `string | undefined` expectation
   * cannot express, because "the definition declares no default" and "no expectation could be
   * derived" would be the same value, and the first must block while the second must not.
   */
  describe("column defaults", () => {
    const storedCheckbox: ReconcilableField[] = [
      { name: "featured", type: "checkbox" },
    ];

    function planWithDefaults(
      liveDefault: string | undefined,
      expected: { known: boolean; value?: string }
    ) {
      const live = liveTableFor(storedCheckbox);
      const col = live.columns.find(c => c.name === "featured");
      if (col) {
        col.default = liveDefault;
        // Stated rather than assumed: the normaliser only collapses 1/0 to a boolean when it is
        // told the column is one, so a fixture that left the type to chance would be testing the
        // fallback path while reading as though it tested the boolean one.
        col.type = "boolean";
      }
      return plan({
        storedFields: storedCheckbox,
        liveMain: live,
        expectedColumnDefault: () => expected,
      });
    }

    it("refuses when the live default no longer matches the declared one", () => {
      const result = planWithDefaults("false", { known: true, value: "true" });
      expect(result.blockers).toEqual([
        expect.objectContaining({
          fieldName: "featured",
          kind: "column-default-changed",
        }),
      ]);
    });

    // The case the third state exists for: the authored default was REMOVED while the column kept
    // its own. A two-valued expectation reports this as nothing to compare.
    it("refuses when the definition declares no default and the column has one", () => {
      const result = planWithDefaults("true", { known: true });
      expect(result.blockers).toEqual([
        expect.objectContaining({ kind: "column-default-changed" }),
      ]);
    });

    // The dialects spell one value differently — SQLite stores a boolean default as 1 where
    // PostgreSQL reports `true` — so a raw string compare would report drift on every healthy
    // SQLite group. This is the pair that proves the comparison runs through the normaliser.
    it("accepts a live default that matches after normalisation", () => {
      const result = planWithDefaults("1", { known: true, value: "true" });
      expect(result.blockers).toEqual([]);
    });

    // The negative control. `known: false` must SKIP, never block — the companion reports it for
    // every column, so blocking here would refuse every localized group.
    it("stays silent when no default expectation could be derived", () => {
      const result = planWithDefaults("true", { known: false });
      expect(result.blockers).toEqual([]);
    });
  });

  /**
   * Structural integrity: a table missing a system column or its parent index cannot do its job,
   * and this operation issues no DDL, so the only honest answer is to refuse.
   *
   * The positive controls below REMOVE something from a table the generator produced, rather than
   * hand-building a broken one — so each asserts on the absence of exactly what the real generator
   * emits, and cannot drift from it.
   */
  describe("structural integrity", () => {
    const stored: ReconcilableField[] = [{ name: "title", type: "text" }];

    it("refuses a main table missing a system column", () => {
      const live = liveTableFor(stored);
      live.columns = live.columns.filter(c => c.name !== "_parent_id");

      const result = plan({ storedFields: stored, liveMain: live });

      expect(result.blockers).toEqual([
        expect.objectContaining({
          columnName: "_parent_id",
          kind: "structural-column-missing",
        }),
      ]);
    });

    it("refuses a main table missing its parent index", () => {
      const live = liveTableFor(stored);
      live.indexes = (live.indexes ?? []).filter(
        index => index.columns.length === 1
      );

      const result = plan({ storedFields: stored, liveMain: live });

      expect(result.blockers).toEqual([
        expect.objectContaining({ kind: "system-index-missing" }),
      ]);
    });

    // An index over the same columns in a different ORDER is a different object: only this order
    // serves a lookup by parent id. Matched by ordered list rather than by name or by set.
    it("refuses a parent index whose columns are in the wrong order", () => {
      const live = liveTableFor(stored);
      for (const index of live.indexes ?? []) {
        if (index.columns.length > 1)
          index.columns = [...index.columns].reverse();
      }

      const result = plan({ storedFields: stored, liveMain: live });

      expect(result.blockers).toEqual([
        expect.objectContaining({ kind: "system-index-missing" }),
      ]);
    });

    /**
     * The companion's composite key is load-bearing at runtime rather than merely structural:
     * localized writes match rows on `(_parent, _locale)`. A companion that kept both columns and
     * lost the key passes every other check here while failing every localized write on
     * PostgreSQL and SQLite, and silently accepting duplicate locale rows on MySQL.
     */
    it("refuses a companion whose key columns are no longer its primary key", () => {
      const localizedStored: ReconcilableField[] = [
        { name: "title", type: "text", localized: true },
      ];
      const companion = companionWith([{ name: "title" }]);
      for (const column of companion.columns) delete column.primaryKey;

      const result = plan({
        storedFields: localizedStored,
        storedLocalized: true,
        liveMain: liveTableFor(localizedStored, { localized: true }),
        liveCompanion: companion,
      });

      expect(result.blockers.map(b => b.columnName).sort()).toEqual([
        "_locale",
        "_parent",
      ]);
    });

    // The negative control that keeps the companion check honest: a field group is never
    // Draft/Published, so its companion has no `_status` and requiring one would refuse every
    // localized group.
    it("does not require a status column on a field group's companion", () => {
      const localizedStored: ReconcilableField[] = [
        { name: "title", type: "text", localized: true },
      ];
      const result = plan({
        storedFields: localizedStored,
        storedLocalized: true,
        liveMain: liveTableFor(localizedStored, { localized: true }),
        liveCompanion: companionWith([{ name: "title" }]),
      });

      expect(result.blockers).toEqual([]);
    });
  });

  /**
   * A vanished field standing beside an unclaimed column is equally a rename and a drop-plus-add,
   * and resolving it silently discards authored configuration that nothing in the database retains.
   */
  it("refuses when a removal and an adoption could be one rename", () => {
    const stored: ReconcilableField[] = [{ name: "headline", type: "text" }];
    // The table the rename produced: the old column is gone, the new one is described by no field.
    const live = liveTableFor([{ name: "title", type: "text" }]);

    const result = plan({ storedFields: stored, liveMain: live });

    expect(result.blockers).toEqual([
      expect.objectContaining({ kind: "ambiguous-rename" }),
    ]);
  });

  // The negative control: a removal with NO unclaimed column beside it is an unambiguous drop and
  // must still be repaired, or the commonest divergence stops being fixable.
  it("still removes a vanished field when nothing appeared to pair it with", () => {
    const stored: ReconcilableField[] = [
      { name: "title", type: "text" },
      { name: "subtitle", type: "text" },
    ];
    const live = liveTableFor([{ name: "title", type: "text" }]);

    const result = plan({ storedFields: stored, liveMain: live });

    expect(result.blockers).toEqual([]);
    expect(result.removed.map(r => r.fieldName)).toEqual(["subtitle"]);
  });

  /**
   * A width change is a physical change, and the canonical form deliberately discards it.
   *
   * That strip is right for PostgreSQL, whose introspection reads `udt_name` and never reports a
   * length — but MySQL reports `COLUMN_TYPE`, which does. So a `maxLength` edit that resized the
   * column and then failed its registry write leaves the two comparing equal under the canonical
   * form alone, and the definition keeps a width the column no longer has.
   */
  describe("type width", () => {
    const stored: ReconcilableField[] = [{ name: "title", type: "text" }];

    function planWithWidths(liveType: string, expected: string) {
      const live = liveTableFor(stored);
      const col = live.columns.find(c => c.name === "title");
      if (col) col.type = liveType;
      return plan({
        storedFields: stored,
        liveMain: live,
        expectedColumnType: () => expected,
      });
    }

    it("refuses when both sides report a width and they differ", () => {
      const result = planWithWidths("varchar(32)", "VARCHAR(255)");
      expect(result.blockers).toEqual([
        expect.objectContaining({
          fieldName: "title",
          kind: "physical-type-changed",
        }),
      ]);
    });

    it("accepts equal widths", () => {
      expect(planWithWidths("varchar(255)", "VARCHAR(255)").blockers).toEqual(
        []
      );
    });

    // The negative control, and the reason the check is gated on BOTH sides carrying a modifier:
    // PostgreSQL's introspected type has none, so demanding one would refuse every healthy
    // PostgreSQL column whose declaration happens to specify a length.
    it("stays silent when the live side reports no width", () => {
      expect(planWithWidths("varchar", "VARCHAR(255)").blockers).toEqual([]);
    });
  });

  // The control that keeps the check from firing on a column it has no expectation for. Absence
  // must SKIP rather than block — treating "I could not derive an expectation" as drift is what
  // made reconcile refuse healthy groups containing dates and relations.
  it("stays silent when no expected type is known for the column", () => {
    const stored: ReconcilableField[] = [{ name: "weight", type: "number" }];
    const live = liveTableFor([{ name: "weight", type: "number" }]);
    const col = live.columns.find(c => c.name === "weight");
    if (col) col.type = "text";

    const result = plan({ storedFields: stored, liveMain: live });

    expect(result.blockers).toEqual([]);
  });

  it("refuses a live column whose identifier no field name can represent", () => {
    const live = liveTableFor([{ name: "title", type: "text" }]);
    live.columns.push({ name: "Legacy-Title", type: "text", nullable: true });

    const result = plan({
      storedFields: [{ name: "title", type: "text" }],
      liveMain: live,
    });

    expect(result.blockers).toEqual([
      expect.objectContaining({ kind: "unrepresentable-column-name" }),
    ]);
    // And it is NOT adopted: persisting it would violate the field contract.
    expect(result.fields.find(f => f.name === "Legacy-Title")).toBeUndefined();
  });

  // 🔴 A localized group whose last translatable field was removed leaves a companion holding only
  // structural columns — physically identical to a never-localized group. Reading that as "not
  // localized" would make the documented idempotent repair the thing that breaks the group, by
  // routing the next default-translatable field to the wrong table.
  it("keeps localization when the companion is structurally empty but the row says localized", () => {
    const stored: ReconcilableField[] = [{ name: "weight", type: "number" }];
    const result = plan({
      storedFields: stored,
      liveMain: liveTableFor(stored, { localized: true }),
      liveCompanion: companionWith([]),
      storedLocalized: true,
    });

    expect(result.localized).toBe(true);
    expect(result.unchanged).toBe(true);
  });

  it("adopts a companion-resident unknown column as a localized field", () => {
    const stored: ReconcilableField[] = [
      { name: "title", type: "text", localized: true },
    ];
    const result = plan({
      storedFields: stored,
      liveMain: liveTableFor(stored, { localized: true }),
      liveCompanion: companionWith([{ name: "title" }, { name: "tagline" }]),
      storedLocalized: true,
    });

    expect(result.adopted).toEqual([
      {
        fieldName: "tagline",
        columnName: "tagline",
        table: "companion",
        liveType: "text",
        guessedType: "text",
      },
    ]);
    expect(result.fields.find(f => f.name === "tagline")).toMatchObject({
      type: "text",
      localized: true,
      required: false,
    });
  });
});
