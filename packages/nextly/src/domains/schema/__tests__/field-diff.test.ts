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

  // A field made through the REST API, the Direct API or code may store neither flag, while the
  // Builder always sends both as booleans: a missing flag is the same as false.
  it.each([
    ["saved unchanged", {}],
    ["saved with only its label changed", { label: "Summary text" }],
  ])(
    "finds no change in a field stored without required, unique or hasMany, %s",
    (_case, edit) => {
      const stored: FieldDefinition[] = [
        { name: "summary", type: "text" },
        { name: "author", type: "relationship", relationTo: "users" },
      ];
      const fromBuilder: FieldDefinition[] = [
        {
          name: "summary",
          type: "text",
          required: false,
          unique: false,
          ...edit,
        },
        {
          name: "author",
          type: "relationship",
          relationTo: "users",
          required: false,
          unique: false,
          hasMany: false,
        },
      ];

      const diff = computeFieldDiff(stored, fromBuilder);

      expect(diff.changed).toEqual([]);
      expect(diff.hasChanges).toBe(false);
    }
  );

  it("still finds a field made required that was stored without the flag", () => {
    const diff = computeFieldDiff(
      [{ name: "summary", type: "text" }],
      [{ name: "summary", type: "text", required: true }]
    );

    expect(diff.changed).toEqual([
      expect.objectContaining({
        name: "summary",
        reason: "constraint_changed",
      }),
    ]);
  });

  describe("in a translated entity", () => {
    // Where a field's values are stored is decided by the entity, then the field's own setting,
    // then its type: a text field is translated unless it says otherwise, a number is not.
    it("finds a change when a field stored without settings is turned translated", () => {
      const diff = computeFieldDiff(
        [{ name: "views", type: "number" }],
        [
          {
            name: "views",
            type: "number",
            required: false,
            unique: false,
            localized: true,
          },
        ],
        { localized: true }
      );

      expect(diff.hasChanges).toBe(true);
      expect(diff.changed).toEqual([
        expect.objectContaining({ name: "views" }),
      ]);
    });

    it("finds a change when a text field stored without settings is turned untranslated", () => {
      const diff = computeFieldDiff(
        [{ name: "summary", type: "text" }],
        [{ name: "summary", type: "text", localized: false }],
        { localized: true }
      );

      expect(diff.hasChanges).toBe(true);
    });

    it("finds no change when the Builder states the setting the field already had by default", () => {
      const diff = computeFieldDiff(
        [{ name: "summary", type: "text" }],
        [
          {
            name: "summary",
            type: "text",
            required: false,
            unique: false,
            localized: true,
          },
        ],
        { localized: true }
      );

      expect(diff.hasChanges).toBe(false);
    });
  });

  it("finds no change in a field's translation setting where the entity is not translated", () => {
    const diff = computeFieldDiff(
      [{ name: "summary", type: "text" }],
      [{ name: "summary", type: "text", localized: true }]
    );

    expect(diff.hasChanges).toBe(false);
  });
});
