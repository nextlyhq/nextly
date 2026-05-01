// Phase D Option 2 (2026-05-01): unit tests for the structural rename
// detection in DynamicCollectionSchemaService.generateAlterTableMigration.
//
// Pre-Phase-D, this method diffed by name only — renaming a field from
// "salary" to "compensation" emitted DROP COLUMN salary + ADD COLUMN
// compensation, destroying every value in the salary column. These
// tests pin down the new behavior:
//   - Unambiguous rename (1 removed + 1 added, compatible types) →
//     emits ALTER TABLE RENAME COLUMN, no DROP/ADD
//   - Ambiguous case (≥2 removed or ≥2 added) → falls back to DROP/ADD
//     and warns; user must rename one field at a time
//   - Type mismatch → falls back to DROP/ADD; data-loss warning
//   - manyToMany relations → falls back to DROP/ADD (junction-table
//     rename has its own handling we don't auto-do)
//
// Reference: findings/issue-3-rename-fix-plans.md (Option 2 detail).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { DynamicCollectionSchemaService } from "../services/dynamic-collection-schema-service";

describe("DynamicCollectionSchemaService.generateAlterTableMigration — Phase D rename detection", () => {
  let service: DynamicCollectionSchemaService;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    service = new DynamicCollectionSchemaService(undefined, "sqlite");
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("emits ALTER TABLE RENAME COLUMN for an unambiguous rename (one removed + one added, same type)", () => {
    // Old: { salary: text }, New: { compensation: text }
    // Single rename, compatible types → safe heuristic fires.
    const oldFields: FieldDefinition[] = [
      { name: "salary", type: "text" },
      { name: "title", type: "text" },
    ];
    const newFields: FieldDefinition[] = [
      { name: "compensation", type: "text" },
      { name: "title", type: "text" },
    ];

    const sql = service.generateAlterTableMigration(
      "dc_jobs",
      oldFields,
      newFields
    );

    expect(sql).toContain('RENAME COLUMN "salary" TO "compensation"');
    // No DROP COLUMN salary, no ADD COLUMN compensation — column data
    // is preserved on the same physical column under the new name.
    expect(sql).not.toMatch(/DROP\s+COLUMN\s+"salary"/);
    expect(sql).not.toMatch(/ADD\s+COLUMN\s+"compensation"/);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("snake_cases camelCase field names in the rename SQL", () => {
    // Old field name "yearlyPay" → SQL column "yearly_pay".
    // toSnakeCase is the same conversion ADD/DROP already use.
    const oldFields: FieldDefinition[] = [
      { name: "yearlyPay", type: "number" },
    ];
    const newFields: FieldDefinition[] = [
      { name: "annualCompensation", type: "number" },
    ];

    const sql = service.generateAlterTableMigration(
      "dc_jobs",
      oldFields,
      newFields
    );

    expect(sql).toContain(
      'RENAME COLUMN "yearly_pay" TO "annual_compensation"'
    );
  });

  it("falls back to DROP+ADD when more than one field is removed or added (ambiguity)", () => {
    // Old: [salary, role]; New: [compensation, position].
    // Two renames in one save — heuristic can't disambiguate which old
    // pairs with which new. Bail out, warn, do DROP+ADD.
    const oldFields: FieldDefinition[] = [
      { name: "salary", type: "text" },
      { name: "role", type: "text" },
    ];
    const newFields: FieldDefinition[] = [
      { name: "compensation", type: "text" },
      { name: "position", type: "text" },
    ];

    const sql = service.generateAlterTableMigration(
      "dc_jobs",
      oldFields,
      newFields
    );

    expect(sql).not.toContain("RENAME COLUMN");
    expect(sql).toMatch(/DROP\s+COLUMN\s+"salary"/);
    expect(sql).toMatch(/DROP\s+COLUMN\s+"role"/);
    expect(sql).toMatch(/ADD\s+COLUMN\s+"compensation"/);
    expect(sql).toMatch(/ADD\s+COLUMN\s+"position"/);
    expect(warnSpy).toHaveBeenCalled();
    const warnMessage = (warnSpy.mock.calls[0]?.[0] as string) ?? "";
    expect(warnMessage).toContain("ambiguous");
  });

  it("falls back to DROP+ADD when the removed and added field types do not match", () => {
    // Old: { salary: text }, New: { compensation: number }.
    // Types differ → would lose data even with rename (varchar vs int).
    // Bail out and warn; let user do an explicit two-step migration.
    const oldFields: FieldDefinition[] = [
      { name: "salary", type: "text" },
    ];
    const newFields: FieldDefinition[] = [
      { name: "compensation", type: "number" },
    ];

    const sql = service.generateAlterTableMigration(
      "dc_jobs",
      oldFields,
      newFields
    );

    expect(sql).not.toContain("RENAME COLUMN");
    expect(sql).toMatch(/DROP\s+COLUMN\s+"salary"/);
    expect(sql).toMatch(/ADD\s+COLUMN\s+"compensation"/);
    expect(warnSpy).toHaveBeenCalled();
    const warnMessage = (warnSpy.mock.calls[0]?.[0] as string) ?? "";
    expect(warnMessage).toContain("not compatible");
  });

  it("does NOT auto-rename manyToMany relations (they use junction tables, not columns)", () => {
    // Old: tags as manyToMany relation, New: categories as same kind.
    // manyToMany doesn't create a column on the main table — renaming
    // is a different operation (rename junction table). Bail out so
    // the user (or a follow-up phase) handles junction-table rename
    // explicitly. The fallback drops the old junction and creates the
    // new one — data loss in the join, surfaced via the existing
    // generate-junction-table path.
    const oldFields: FieldDefinition[] = [
      {
        name: "tags",
        type: "relation",
        options: { relationType: "manyToMany", target: "tags" },
      },
    ];
    const newFields: FieldDefinition[] = [
      {
        name: "categories",
        type: "relation",
        options: { relationType: "manyToMany", target: "tags" },
      },
    ];

    const sql = service.generateAlterTableMigration(
      "dc_posts",
      oldFields,
      newFields
    );

    expect(sql).not.toContain("RENAME COLUMN");
    expect(warnSpy).toHaveBeenCalled();
  });

  it("auto-renames non-manyToMany relations when target + relationType match", () => {
    // Old: author (manyToOne -> users), New: editor (manyToOne -> users).
    // Same target collection, same relation kind → safe rename.
    const oldFields: FieldDefinition[] = [
      {
        name: "author",
        type: "relation",
        options: { relationType: "manyToOne", target: "users" },
      },
    ];
    const newFields: FieldDefinition[] = [
      {
        name: "editor",
        type: "relation",
        options: { relationType: "manyToOne", target: "users" },
      },
    ];

    const sql = service.generateAlterTableMigration(
      "dc_posts",
      oldFields,
      newFields
    );

    expect(sql).toContain('RENAME COLUMN "author" TO "editor"');
    expect(sql).not.toMatch(/DROP\s+COLUMN\s+"author"/);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does not auto-rename relations when their target collection differs", () => {
    // author -> users, editor -> staff. Different target collections
    // means the FK semantics change. Bail out — user must do this in
    // two steps (rename, then change target).
    const oldFields: FieldDefinition[] = [
      {
        name: "author",
        type: "relation",
        options: { relationType: "manyToOne", target: "users" },
      },
    ];
    const newFields: FieldDefinition[] = [
      {
        name: "editor",
        type: "relation",
        options: { relationType: "manyToOne", target: "staff" },
      },
    ];

    const sql = service.generateAlterTableMigration(
      "dc_posts",
      oldFields,
      newFields
    );

    expect(sql).not.toContain("RENAME COLUMN");
    expect(warnSpy).toHaveBeenCalled();
  });

  it("pure add (only added fields, no removed) does not trigger rename detection", () => {
    const oldFields: FieldDefinition[] = [
      { name: "title", type: "text" },
    ];
    const newFields: FieldDefinition[] = [
      { name: "title", type: "text" },
      { name: "summary", type: "text" },
    ];

    const sql = service.generateAlterTableMigration(
      "dc_posts",
      oldFields,
      newFields
    );

    expect(sql).not.toContain("RENAME COLUMN");
    expect(sql).toMatch(/ADD\s+COLUMN\s+"summary"/);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("pure drop (only removed fields, no added) does not trigger rename detection", () => {
    const oldFields: FieldDefinition[] = [
      { name: "title", type: "text" },
      { name: "summary", type: "text" },
    ];
    const newFields: FieldDefinition[] = [
      { name: "title", type: "text" },
    ];

    const sql = service.generateAlterTableMigration(
      "dc_posts",
      oldFields,
      newFields
    );

    expect(sql).not.toContain("RENAME COLUMN");
    expect(sql).toMatch(/DROP\s+COLUMN\s+"summary"/);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("DynamicCollectionSchemaService.detectFieldRename — direct unit", () => {
  it("returns null when nothing was added or removed", () => {
    const service = new DynamicCollectionSchemaService(undefined, "postgresql");
    const fields: FieldDefinition[] = [{ name: "title", type: "text" }];
    expect(service.detectFieldRename(fields, fields)).toBeNull();
  });

  it("returns the from→to pair for a single compatible rename", () => {
    const service = new DynamicCollectionSchemaService(undefined, "postgresql");
    const oldFields: FieldDefinition[] = [
      { name: "salary", type: "number" },
    ];
    const newFields: FieldDefinition[] = [
      { name: "compensation", type: "number" },
    ];
    const result = service.detectFieldRename(oldFields, newFields);
    expect(result).not.toBeNull();
    expect(result?.from.name).toBe("salary");
    expect(result?.to.name).toBe("compensation");
  });
});
