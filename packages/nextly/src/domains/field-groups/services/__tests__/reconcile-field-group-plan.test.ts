import { describe, expect, it } from "vitest";

import { buildDesiredTableFromComponentFields } from "../../../schema/pipeline/diff/build-from-fields";
import type { TableSpec } from "../../../schema/pipeline/diff/types";
import {
  planFieldGroupReconcile,
  type ReconcilableField,
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

/** A companion holding the given user columns beside its structural pair. */
function companionWith(
  columns: Array<{ name: string; type?: string }>
): TableSpec {
  return {
    name: COMPANION,
    columns: [
      { name: "_parent", type: "text", nullable: false },
      { name: "_locale", type: "varchar", nullable: false },
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
}) {
  return planFieldGroupReconcile({
    storedFields: args.storedFields,
    dialect: DIALECT,
    tableName: TABLE,
    liveMain: args.liveMain,
    liveCompanion: args.liveCompanion ?? null,
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

  it("adopts a companion-resident unknown column as a localized field", () => {
    const stored: ReconcilableField[] = [
      { name: "title", type: "text", localized: true },
    ];
    const result = plan({
      storedFields: stored,
      liveMain: liveTableFor(stored, { localized: true }),
      liveCompanion: companionWith([{ name: "title" }, { name: "tagline" }]),
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
