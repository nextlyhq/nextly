// Tests for translatePipelinePreviewToLegacy — F8 PR 3.
//
// Asserts the translator produces the legacy SchemaPreviewResult shape
// that the admin SchemaChangeDialog renders. Tests with synthetic
// pipeline preview output + synthetic field arrays; the live-DB row
// counting is mocked.

import { describe, it, expect, vi } from "vitest";

import type { ClassifierEvent } from "../../pipeline/resolution/types";
import type { PipelinePreviewResult } from "../../pipeline/preview";
import type { FieldDefinition } from "../../../../schemas/dynamic-collections";

import { translatePipelinePreviewToLegacy } from "../translate";

const emptyPreview: PipelinePreviewResult = {
  operations: [],
  events: [],
  candidates: [],
  classification: "safe",
  liveSnapshot: { tables: [] },
};

describe("translatePipelinePreviewToLegacy", () => {
  it("returns no-changes shape when fields are identical", async () => {
    const fields: FieldDefinition[] = [
      { name: "title", type: "text", required: true } as FieldDefinition,
    ];

    const result = await translatePipelinePreviewToLegacy(emptyPreview, {
      tableName: "dc_posts",
      currentFields: fields,
      newFields: fields,
      db: {},
      dialect: "sqlite",
    });

    expect(result.hasChanges).toBe(false);
    expect(result.hasDestructiveChanges).toBe(false);
    expect(result.classification).toBe("safe");
    expect(result.changes.added).toEqual([]);
    expect(result.changes.removed).toEqual([]);
    expect(result.changes.changed).toEqual([]);
    expect(result.changes.unchanged).toEqual(["title"]);
    expect(result.warnings).toEqual([]);
    expect(result.interactiveFields).toEqual([]);
  });

  it("translates added field with default classification 'safe'", async () => {
    const currentFields: FieldDefinition[] = [
      { name: "title", type: "text" } as FieldDefinition,
    ];
    const newFields: FieldDefinition[] = [
      { name: "title", type: "text" } as FieldDefinition,
      { name: "body", type: "text" } as FieldDefinition,
    ];

    const result = await translatePipelinePreviewToLegacy(emptyPreview, {
      tableName: "dc_posts",
      currentFields,
      newFields,
      db: {},
      dialect: "sqlite",
    });

    expect(result.hasChanges).toBe(true);
    expect(result.changes.added.length).toBe(1);
    expect(result.changes.added[0]).toMatchObject({
      name: "body",
      type: "text",
      classification: "safe",
    });
  });

  it("translates required-no-default event into interactiveField shape", async () => {
    const event: ClassifierEvent = {
      id: "add_required_field_no_default:dc_posts.title",
      kind: "add_required_field_no_default",
      tableName: "dc_posts",
      columnName: "title",
      tableRowCount: 50,
      applicableResolutions: ["provide_default", "make_optional", "abort"],
    };

    const preview: PipelinePreviewResult = {
      ...emptyPreview,
      events: [event],
      classification: "interactive",
    };

    const currentFields: FieldDefinition[] = [];
    const newFields: FieldDefinition[] = [
      { name: "title", type: "text", required: true } as FieldDefinition,
    ];

    const result = await translatePipelinePreviewToLegacy(preview, {
      tableName: "dc_posts",
      currentFields,
      newFields,
      db: {},
      dialect: "sqlite",
    });

    expect(result.classification).toBe("interactive");
    expect(result.hasDestructiveChanges).toBe(true);
    expect(result.interactiveFields.length).toBe(1);
    expect(result.interactiveFields[0]).toEqual({
      name: "title",
      reason: "new_required_no_default",
      tableRowCount: 50,
      options: ["provide_default", "mark_nullable", "cancel"],
    });
  });

  it("translates not-null-with-nulls event with nullCount", async () => {
    const event: ClassifierEvent = {
      id: "add_not_null_with_nulls:dc_posts.title",
      kind: "add_not_null_with_nulls",
      tableName: "dc_posts",
      columnName: "title",
      nullCount: 3,
      tableRowCount: 50,
      applicableResolutions: [
        "provide_default",
        "make_optional",
        "delete_nonconforming",
        "abort",
      ],
    };

    const preview: PipelinePreviewResult = {
      ...emptyPreview,
      events: [event],
      classification: "interactive",
    };

    const result = await translatePipelinePreviewToLegacy(preview, {
      tableName: "dc_posts",
      currentFields: [{ name: "title", type: "text" } as FieldDefinition],
      newFields: [
        { name: "title", type: "text", required: true } as FieldDefinition,
      ],
      db: {},
      dialect: "sqlite",
    });

    expect(result.interactiveFields.length).toBe(1);
    expect(result.interactiveFields[0]).toEqual({
      name: "title",
      reason: "nullable_to_not_null_with_nulls",
      tableRowCount: 50,
      nullCount: 3,
      // Legacy 3-option set: delete_nonconforming intentionally omitted
      options: ["provide_default", "mark_nullable", "cancel"],
    });
  });

  it("translates type_change event into a warning string only", async () => {
    const event: ClassifierEvent = {
      id: "type_change:dc_posts.count",
      kind: "type_change",
      tableName: "dc_posts",
      columnName: "count",
      fromType: "text",
      toType: "integer",
      isWidening: false,
      perDialectWarning: {
        pg: "PG: type cast may fail",
        mysql: "MySQL: silent truncation",
        sqlite: "SQLite: silent coercion",
      },
    };

    const preview: PipelinePreviewResult = {
      ...emptyPreview,
      events: [event],
      classification: "destructive",
    };

    const result = await translatePipelinePreviewToLegacy(preview, {
      tableName: "dc_posts",
      currentFields: [{ name: "count", type: "text" } as FieldDefinition],
      newFields: [{ name: "count", type: "integer" } as FieldDefinition],
      db: {},
      dialect: "sqlite",
    });

    // type_change events surface as warnings, not interactiveFields
    // (legacy admin dialog has no UX for force-cast — F11 may add).
    expect(result.interactiveFields).toEqual([]);
    expect(
      result.warnings.some(w => w.includes("count") && w.includes("text"))
    ).toBe(true);
    expect(result.classification).toBe("destructive");
  });

  it("counts non-null rows for removed fields via db queries", async () => {
    const currentFields: FieldDefinition[] = [
      { name: "title", type: "text" } as FieldDefinition,
      { name: "body", type: "text" } as FieldDefinition,
    ];
    const newFields: FieldDefinition[] = [
      { name: "title", type: "text" } as FieldDefinition,
    ];

    // Mock db: SQLite shape (.all returns rows synchronously).
    // Translator calls countRows first (one call upfront), then
    // countNulls once per removed field. Order: [countRows, countNulls(body)].
    // Total = 100, nulls = 25 → non-null = 75.
    let callIndex = 0;
    const responses = [{ count: 100 }, { count: 25 }];
    const dbMock = {
      all: vi.fn().mockImplementation(() => {
        const response = responses[callIndex] ?? { count: 0 };
        callIndex += 1;
        return [response];
      }),
    };

    const result = await translatePipelinePreviewToLegacy(emptyPreview, {
      tableName: "dc_posts",
      currentFields,
      newFields,
      db: dbMock,
      dialect: "sqlite",
    });

    expect(result.changes.removed.length).toBe(1);
    expect(result.changes.removed[0]).toMatchObject({
      name: "body",
      type: "text",
      rowCount: 75, // non-null = total - null
    });
  });

  it("classes a removal it could not count as deleting data, with its count unknown", async () => {
    const currentFields: FieldDefinition[] = [
      { name: "title", type: "text" } as FieldDefinition,
      { name: "body", type: "text" } as FieldDefinition,
    ];
    const newFields: FieldDefinition[] = [
      { name: "title", type: "text" } as FieldDefinition,
    ];

    const dbMock = {
      all: vi.fn().mockImplementation(() => {
        throw new Error("table does not exist");
      }),
    };

    const result = await translatePipelinePreviewToLegacy(emptyPreview, {
      tableName: "dc_posts",
      currentFields,
      newFields,
      db: dbMock,
      dialect: "sqlite",
    });

    // Not "nothing is deleted": the values were never counted.
    expect(result.changes.removed[0]).toMatchObject({
      rowCount: 0,
      rowCountUnknown: true,
      classification: "destructive",
    });
    expect(result.classification).not.toBe("safe");
  });

  it("preserves unchanged field names", async () => {
    const fields: FieldDefinition[] = [
      { name: "id", type: "text" } as FieldDefinition,
      { name: "title", type: "text" } as FieldDefinition,
    ];
    const newFields: FieldDefinition[] = [
      ...fields,
      { name: "body", type: "text" } as FieldDefinition,
    ];

    const result = await translatePipelinePreviewToLegacy(emptyPreview, {
      tableName: "dc_posts",
      currentFields: fields,
      newFields,
      db: {},
      dialect: "sqlite",
    });

    expect(result.changes.unchanged).toEqual(["id", "title"]);
  });

  it("ddlPreview defaults to empty (legacy behavior was best-effort)", async () => {
    const result = await translatePipelinePreviewToLegacy(emptyPreview, {
      tableName: "dc_posts",
      currentFields: [],
      newFields: [],
      db: {},
      dialect: "sqlite",
    });
    expect(result.ddlPreview).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// What a removal and a relationship change are classed as, cell by cell.
//
// A count the preview cannot read must never read as "nothing is deleted",
// and a field's values are counted where they are stored. The SQLite double
// below answers each count query from the table and column it names, and
// records every query, so a test sees both what was counted and where.

interface CountTable {
  /** Rows in the table, or an Error the row count throws. */
  rows: number | Error;
  /** Null count per column; a column absent here throws, as SQLite does. */
  nulls: Record<string, number | Error>;
}

function countingDb(tables: Record<string, CountTable>) {
  const queries: string[] = [];
  const db = {
    all: vi.fn().mockImplementation((query: unknown) => {
      const text = JSON.stringify(query);
      queries.push(text);
      const name = Object.keys(tables).find(t => text.includes(`\\"${t}\\"`));
      if (!name) throw new Error(`no such table in ${text}`);
      const table = tables[name];
      const isNullCount = text.includes("IS NULL");
      if (!isNullCount) {
        if (table.rows instanceof Error) throw table.rows;
        return [{ count: table.rows }];
      }
      const column = Object.keys(table.nulls).find(c =>
        text.includes(`\\"${c}\\" IS NULL`)
      );
      if (!column) throw new Error(`no such column in ${text}`);
      const nulls = table.nulls[column];
      if (nulls instanceof Error) throw nulls;
      return [{ count: nulls }];
    }),
  };
  return { db, queries };
}

const text = (name: string, extra: Record<string, unknown> = {}) =>
  ({ name, type: "text", ...extra }) as FieldDefinition;

async function removing(
  removed: FieldDefinition[],
  db: unknown,
  options: { localized?: boolean; kept?: FieldDefinition[] } = {}
) {
  const kept = options.kept ?? [text("title")];
  return translatePipelinePreviewToLegacy(emptyPreview, {
    tableName: "dc_posts",
    currentFields: [...kept, ...removed],
    newFields: kept,
    db,
    dialect: "sqlite",
    localized: options.localized,
  });
}

describe("a removal the preview cannot count, and where it counts", () => {
  // --- The dangerous direction: a removal that deletes values. ---

  it("classes every removal as deleting data when the row count throws", async () => {
    const { db } = countingDb({
      dc_posts: { rows: new Error("locked"), nulls: { body: 0, summary: 0 } },
    });
    const result = await removing([text("body"), text("summary")], db);
    for (const field of result.changes.removed) {
      expect(field, field.name).toMatchObject({
        rowCountUnknown: true,
        classification: "destructive",
      });
    }
    expect(result.classification).toBe("destructive");
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("could not count the rows 'body' holds"),
        expect.stringContaining("could not count the rows 'summary' holds"),
      ])
    );
  });

  it("classes only the field whose null count throws as uncounted", async () => {
    const { db } = countingDb({
      dc_posts: { rows: 10, nulls: { body: new Error("gone"), summary: 4 } },
    });
    const result = await removing([text("body"), text("summary")], db);
    const [body, summary] = result.changes.removed;
    expect(body).toMatchObject({
      rowCountUnknown: true,
      classification: "destructive",
    });
    expect(summary).toMatchObject({
      rowCount: 6,
      classification: "destructive",
    });
    expect(summary).not.toHaveProperty("rowCountUnknown");
  });

  it("counts a translated field's values in its companion table", async () => {
    // The main table has no column for a translated field: counting there
    // throws, which read as 0 rows, "nothing is deleted".
    const { db, queries } = countingDb({
      dc_posts: { rows: 3, nulls: {} },
      dc_posts_locales: { rows: 5, nulls: { summary: 1 } },
    });
    const result = await removing([text("summary")], db, { localized: true });
    expect(result.changes.removed[0]).toMatchObject({
      rowCount: 4,
      classification: "destructive",
    });
    expect(result.changes.removed[0]).not.toHaveProperty("rowCountUnknown");
    expect(queries.some(q => q.includes("dc_posts_locales"))).toBe(true);
  });

  it("counts a field marked not translated on the main table of a translated entity", async () => {
    const { db } = countingDb({
      dc_posts: { rows: 3, nulls: { slug: 1 } },
      dc_posts_locales: { rows: 5, nulls: {} },
    });
    const result = await removing([text("slug", { localized: false })], db, {
      localized: true,
    });
    expect(result.changes.removed[0]).toMatchObject({
      rowCount: 2,
      classification: "destructive",
    });
  });

  it("counts an unflagged field that is not translated by default on the main table", async () => {
    // A number is not translated unless it says so, so on a translated entity
    // its column is still on the main table, not the companion.
    const { db } = countingDb({
      dc_posts: { rows: 3, nulls: { views: 0 } },
      dc_posts_locales: { rows: 5, nulls: {} },
    });
    const result = await removing(
      [{ name: "views", type: "number" } as FieldDefinition],
      db,
      { localized: true }
    );
    expect(result.changes.removed[0]).toMatchObject({
      rowCount: 3,
      classification: "destructive",
    });
    expect(result.changes.removed[0]).not.toHaveProperty("rowCountUnknown");
  });

  it("counts fields stored in two tables against each table's own rows", async () => {
    const { db } = countingDb({
      dc_posts: { rows: 3, nulls: { views: 1 } },
      dc_posts_locales: { rows: 8, nulls: { summary: 2 } },
    });
    const result = await removing(
      [text("summary"), { name: "views", type: "number" } as FieldDefinition],
      db,
      { localized: true }
    );
    const byName = Object.fromEntries(
      result.changes.removed.map(f => [f.name, f.rowCount])
    );
    expect(byName).toEqual({ summary: 6, views: 2 });
  });

  it("queries a camelCase field by the column it is stored in", async () => {
    const { db } = countingDb({
      dc_posts: { rows: 2, nulls: { meta_title: 0 } },
    });
    const result = await removing([text("metaTitle")], db);
    expect(result.changes.removed[0]).toMatchObject({
      name: "metaTitle",
      rowCount: 2,
      classification: "destructive",
    });
  });

  it("classes a removed field group, whose values live in their own table, as uncounted", async () => {
    const { db, queries } = countingDb({ dc_posts: { rows: 2, nulls: {} } });
    const result = await removing(
      [{ name: "seo", type: "component" } as FieldDefinition],
      db
    );
    expect(result.changes.removed[0]).toMatchObject({
      rowCountUnknown: true,
      classification: "destructive",
    });
    expect(queries.some(q => q.includes("IS NULL"))).toBe(false);
  });

  it("classes a hasMany toggle as deleting data, in both directions", async () => {
    for (const [from, to] of [
      [false, true],
      [true, false],
      [undefined, true],
    ] as const) {
      const before = {
        name: "authors",
        type: "relationship",
        relationTo: "users",
        hasMany: from,
      } as FieldDefinition;
      const after = { ...before, hasMany: to } as FieldDefinition;
      const result = await translatePipelinePreviewToLegacy(emptyPreview, {
        tableName: "dc_posts",
        currentFields: [before],
        newFields: [after],
        db: {},
        dialect: "sqlite",
      });
      expect(result.changes.changed[0], `${from} -> ${to}`).toMatchObject({
        classification: "destructive",
      });
      expect(result.classification).toBe("destructive");
      expect(result.warnings).toEqual(
        expect.arrayContaining([
          expect.stringContaining(
            "Changing 'authors' between one and many related entries"
          ),
        ])
      );
    }
  });

  it("keeps the type-change warning when a hasMany toggle comes with it", async () => {
    const before = {
      name: "count",
      type: "number",
      hasMany: false,
    } as FieldDefinition;
    const after = { ...before, type: "text", hasMany: true } as FieldDefinition;
    const result = await translatePipelinePreviewToLegacy(emptyPreview, {
      tableName: "dc_posts",
      currentFields: [before],
      newFields: [after],
      db: {},
      dialect: "sqlite",
    });
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("between one and many"),
        expect.stringContaining("type (number -> text)"),
      ])
    );
  });

  it("classes a hasMany toggle as deleting data when required changes with it", async () => {
    const before = {
      name: "authors",
      type: "relationship",
      relationTo: "users",
      hasMany: false,
    } as FieldDefinition;
    const after = {
      ...before,
      hasMany: true,
      required: true,
    } as FieldDefinition;
    const result = await translatePipelinePreviewToLegacy(emptyPreview, {
      tableName: "dc_posts",
      currentFields: [before],
      newFields: [after],
      db: {},
      dialect: "sqlite",
    });
    expect(result.changes.changed[0].classification).toBe("destructive");
  });

  // --- Deletes nothing: unchanged from before. ---

  it("keeps a removed field whose column holds no values safe", async () => {
    const { db } = countingDb({ dc_posts: { rows: 4, nulls: { body: 4 } } });
    const result = await removing([text("body")], db);
    expect(result.changes.removed[0]).toEqual({
      name: "body",
      type: "text",
      rowCount: 0,
      classification: "safe",
    });
    expect(result.classification).toBe("safe");
  });

  it("keeps a removed virtual field, which stores nothing, safe without querying", async () => {
    const { db, queries } = countingDb({ dc_posts: { rows: 4, nulls: {} } });
    const result = await removing([text("preview", { virtual: true })], db);
    expect(result.changes.removed[0]).toMatchObject({
      rowCount: 0,
      classification: "safe",
    });
    expect(queries.some(q => q.includes("IS NULL"))).toBe(false);
  });

  it("keeps a hasMany flag spelled false where it was absent from being a toggle", async () => {
    const before = {
      name: "author",
      type: "relationship",
      relationTo: "users",
    } as FieldDefinition;
    const after = { ...before, hasMany: false } as FieldDefinition;
    const result = await translatePipelinePreviewToLegacy(emptyPreview, {
      tableName: "dc_posts",
      currentFields: [before],
      newFields: [after],
      db: {},
      dialect: "sqlite",
    });
    expect(result.warnings.some(w => w.includes("between one and many"))).toBe(
      false
    );
  });
});
