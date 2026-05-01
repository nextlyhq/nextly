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
      // (Task 22 tracks the admin-UI upgrade to add it).
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

  it("returns rowCount=0 when count queries fail (best-effort)", async () => {
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

    expect(result.changes.removed[0].rowCount).toBe(0);
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
