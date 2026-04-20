// Tests for field definition diff - compares old vs new field definitions
// for the preview endpoint. Pure function, no drizzle-kit dependency.
import { describe, it, expect } from "vitest";

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { computeFieldDiff } from "../services/field-diff";

describe("computeFieldDiff", () => {
  it("detects added fields", () => {
    const oldFields: FieldDefinition[] = [
      { name: "title", type: "text", required: true },
    ];
    const newFields: FieldDefinition[] = [
      { name: "title", type: "text", required: true },
      { name: "category", type: "text" },
    ];

    const diff = computeFieldDiff(oldFields, newFields);

    expect(diff.added).toHaveLength(1);
    expect(diff.added[0].name).toBe("category");
    expect(diff.hasChanges).toBe(true);
    expect(diff.hasDestructiveChanges).toBe(false);
  });

  it("detects removed fields", () => {
    const oldFields: FieldDefinition[] = [
      { name: "title", type: "text", required: true },
      { name: "price", type: "number" },
    ];
    const newFields: FieldDefinition[] = [
      { name: "title", type: "text", required: true },
    ];

    const diff = computeFieldDiff(oldFields, newFields);

    expect(diff.removed).toHaveLength(1);
    expect(diff.removed[0].name).toBe("price");
    expect(diff.hasDestructiveChanges).toBe(true);
  });

  it("detects changed field types", () => {
    const oldFields: FieldDefinition[] = [{ name: "status", type: "text" }];
    const newFields: FieldDefinition[] = [{ name: "status", type: "select" }];

    const diff = computeFieldDiff(oldFields, newFields);

    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].name).toBe("status");
    expect(diff.changed[0].from).toBe("text");
    expect(diff.changed[0].to).toBe("select");
    expect(diff.hasDestructiveChanges).toBe(true);
  });

  it("detects unchanged fields", () => {
    const oldFields: FieldDefinition[] = [
      { name: "title", type: "text", required: true },
      { name: "slug", type: "text" },
    ];
    const newFields: FieldDefinition[] = [
      { name: "title", type: "text", required: true },
      { name: "slug", type: "text" },
    ];

    const diff = computeFieldDiff(oldFields, newFields);

    expect(diff.unchanged).toEqual(["title", "slug"]);
    expect(diff.hasChanges).toBe(false);
    expect(diff.hasDestructiveChanges).toBe(false);
  });

  it("detects changed required flag", () => {
    const oldFields: FieldDefinition[] = [{ name: "title", type: "text" }];
    const newFields: FieldDefinition[] = [
      { name: "title", type: "text", required: true },
    ];

    const diff = computeFieldDiff(oldFields, newFields);

    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].name).toBe("title");
  });

  it("handles empty old fields (new collection)", () => {
    const oldFields: FieldDefinition[] = [];
    const newFields: FieldDefinition[] = [
      { name: "title", type: "text", required: true },
      { name: "body", type: "textarea" },
    ];

    const diff = computeFieldDiff(oldFields, newFields);

    expect(diff.added).toHaveLength(2);
    expect(diff.removed).toHaveLength(0);
    expect(diff.hasDestructiveChanges).toBe(false);
  });

  it("handles empty new fields (delete all)", () => {
    const oldFields: FieldDefinition[] = [{ name: "title", type: "text" }];
    const newFields: FieldDefinition[] = [];

    const diff = computeFieldDiff(oldFields, newFields);

    expect(diff.removed).toHaveLength(1);
    expect(diff.hasDestructiveChanges).toBe(true);
  });

  it("generates warnings for removed fields", () => {
    const oldFields: FieldDefinition[] = [{ name: "price", type: "number" }];
    const newFields: FieldDefinition[] = [];

    const diff = computeFieldDiff(oldFields, newFields);

    expect(diff.warnings.length).toBeGreaterThan(0);
    expect(diff.warnings[0]).toContain("price");
  });

  it("includes reason 'constraint_changed' for optional to required", () => {
    const oldFields: FieldDefinition[] = [
      { name: "title", type: "text", required: false },
    ];
    const newFields: FieldDefinition[] = [
      { name: "title", type: "text", required: true },
    ];

    const diff = computeFieldDiff(oldFields, newFields);

    expect(diff.hasChanges).toBe(true);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].reason).toBe("constraint_changed");
  });

  it("includes reason 'type_changed' for type change", () => {
    const oldFields: FieldDefinition[] = [{ name: "count", type: "text" }];
    const newFields: FieldDefinition[] = [{ name: "count", type: "number" }];

    const diff = computeFieldDiff(oldFields, newFields);

    expect(diff.changed[0].reason).toBe("type_changed");
  });

  it("includes reason 'relation_changed' for relation target change", () => {
    const oldFields: FieldDefinition[] = [
      { name: "author", type: "relationship", relationTo: "users" },
    ];
    const newFields: FieldDefinition[] = [
      { name: "author", type: "relationship", relationTo: "admins" },
    ];

    const diff = computeFieldDiff(oldFields, newFields);

    expect(diff.changed[0].reason).toBe("relation_changed");
  });

  it("includes reason on all changes in mixed scenario", () => {
    const oldFields: FieldDefinition[] = [
      { name: "a", type: "text" },
      { name: "b", type: "text", required: false },
    ];
    const newFields: FieldDefinition[] = [
      { name: "a", type: "number" },
      { name: "b", type: "text", required: true },
    ];

    const diff = computeFieldDiff(oldFields, newFields);

    expect(diff.changed).toHaveLength(2);
    expect(diff.changed.find(c => c.name === "a")?.reason).toBe("type_changed");
    expect(diff.changed.find(c => c.name === "b")?.reason).toBe(
      "constraint_changed"
    );
  });

  it("handles complex mixed changes", () => {
    const oldFields: FieldDefinition[] = [
      { name: "title", type: "text", required: true },
      { name: "price", type: "number" },
      { name: "status", type: "text" },
    ];
    const newFields: FieldDefinition[] = [
      { name: "title", type: "text", required: true },
      { name: "category", type: "text" },
      { name: "status", type: "select" },
    ];

    const diff = computeFieldDiff(oldFields, newFields);

    expect(diff.added).toHaveLength(1);
    expect(diff.added[0].name).toBe("category");
    expect(diff.removed).toHaveLength(1);
    expect(diff.removed[0].name).toBe("price");
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].name).toBe("status");
    expect(diff.unchanged).toEqual(["title"]);
  });
});
