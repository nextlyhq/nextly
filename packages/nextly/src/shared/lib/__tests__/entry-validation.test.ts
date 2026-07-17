/**
 * Guards the shared server-side entry validator: every collection and
 * single write runs these rules (required, length, range, pattern,
 * options, cardinality, nested rows) regardless of the writer, so a
 * regression here would let invalid data reach the database.
 */
import { describe, expect, it } from "vitest";

import { validateEntryData, type ValidatableField } from "../entry-validation";

const FIELDS: ValidatableField[] = [
  { name: "title", type: "text", required: true, minLength: 3, maxLength: 10 },
  { name: "contact", type: "email" },
  { name: "score", type: "number", validation: { min: 1, max: 5 } },
  { name: "active", type: "checkbox" },
  { name: "published_on", type: "date" },
  {
    name: "tier",
    type: "select",
    options: [{ value: "free" }, { value: "pro" }],
  },
  { name: "tags", type: "chips", validation: { minChips: 1, maxChips: 3 } },
  {
    name: "sections",
    type: "repeater",
    validation: { maxRows: 2 },
    fields: [{ name: "heading", type: "text", required: true }],
  },
  {
    name: "sku",
    type: "text",
    validation: {
      pattern: "^[A-Z]{3}-\\d+$",
      message: "Must look like ABC-123",
    },
  },
];

async function issuesFor(
  data: Record<string, unknown>,
  mode: "create" | "update" = "create"
) {
  return validateEntryData(data, FIELDS, { mode });
}

describe("validateEntryData", () => {
  it("passes a fully valid create", async () => {
    const issues = await issuesFor({
      title: "Hello",
      contact: "a@b.co",
      score: 3,
      active: true,
      published_on: "2026-07-17",
      tier: "pro",
      tags: ["one"],
      sections: [{ heading: "Intro" }],
      sku: "ABC-123",
    });
    expect(issues).toEqual([]);
  });

  it("reports required fields on create, all at once", async () => {
    const issues = await issuesFor({});
    expect(issues).toEqual([
      { path: "title", code: "REQUIRED", message: "title is required." },
    ]);
  });

  it("enforces length, range, format, options, and pattern", async () => {
    const issues = await issuesFor({
      title: "ab",
      contact: "not-an-email",
      score: 9,
      active: "yes",
      published_on: "not a date at all",
      tier: "enterprise",
      tags: [],
      sku: "abc123",
    });
    const byPath = Object.fromEntries(issues.map(i => [i.path, i.code]));
    expect(byPath).toEqual({
      title: "TOO_SHORT",
      contact: "INVALID_FORMAT",
      score: "TOO_HIGH",
      active: "INVALID_TYPE",
      published_on: "INVALID_FORMAT",
      tier: "INVALID_OPTION",
      tags: "TOO_FEW_ROWS",
      sku: "INVALID_FORMAT",
    });
    // Pattern message from the schema is used verbatim (with period).
    expect(issues.find(i => i.path === "sku")?.message).toBe(
      "Must look like ABC-123."
    );
  });

  it("update mode skips absent keys but rejects emptied required fields", async () => {
    // Absent title on update: untouched, no issue.
    expect(await issuesFor({ score: 4 }, "update")).toEqual([]);
    // Explicitly emptied required field on update: violation.
    const issues = await issuesFor({ title: "" }, "update");
    expect(issues).toEqual([
      { path: "title", code: "REQUIRED", message: "title is required." },
    ]);
  });

  it("recurses into repeater rows with bracketed paths", async () => {
    const issues = await issuesFor({
      title: "Post",
      sections: [{ heading: "ok" }, {}, { heading: "also ok" }],
    });
    expect(issues).toEqual([
      {
        path: "sections",
        code: "TOO_MANY_ROWS",
        message: "sections must have at most 2 rows.",
      },
      {
        path: "sections[1].heading",
        code: "REQUIRED",
        message: "heading is required.",
      },
    ]);
  });

  it("accepts date-only strings, ISO datetimes, and Date instances", async () => {
    for (const value of ["2026-07-17", "2026-07-17T10:00:00Z", new Date()]) {
      expect(await issuesFor({ title: "Post", published_on: value })).toEqual(
        []
      );
    }
  });

  it("runs custom validate after built-in rules", async () => {
    const fields: ValidatableField[] = [
      {
        name: "code",
        type: "text",
        validate: value =>
          typeof value === "string" && value.startsWith("X")
            ? true
            : "Must start with X",
      },
    ];
    expect(
      await validateEntryData({ code: "X1" }, fields, { mode: "create" })
    ).toEqual([]);
    expect(
      await validateEntryData({ code: "Y1" }, fields, { mode: "create" })
    ).toEqual([
      { path: "code", code: "CUSTOM", message: "Must start with X." },
    ]);
  });

  it("does not reject on hostile (unsafe) stored patterns", async () => {
    const fields: ValidatableField[] = [
      {
        name: "v",
        type: "text",
        // Nested quantifier — the classic ReDoS shape; the safe-regex
        // guard must skip it rather than evaluate it.
        validation: { pattern: "^(a+)+$" },
      },
    ];
    expect(
      await validateEntryData({ v: "aaaaaaaaaaaaaaaaaaaaab" }, fields, {
        mode: "create",
      })
    ).toEqual([]);
  });

  it("enforces hasMany cardinality for text and number fields", async () => {
    const fields: ValidatableField[] = [
      { name: "tags", type: "text", hasMany: true },
      { name: "scores", type: "number", hasMany: true },
    ];
    // Scalars for hasMany fields are rejected.
    expect(
      await validateEntryData({ tags: "solo", scores: 3 }, fields, {
        mode: "create",
      })
    ).toEqual([
      { path: "tags", code: "INVALID_TYPE", message: "tags must be a list." },
      {
        path: "scores",
        code: "INVALID_TYPE",
        message: "scores must be a list.",
      },
    ]);
    // Arrays pass and each element is validated.
    expect(
      await validateEntryData({ tags: ["a", "b"], scores: [1, 2] }, fields, {
        mode: "create",
      })
    ).toEqual([]);
  });

  it("rejects malformed repeater rows instead of skipping them", async () => {
    const fields: ValidatableField[] = [
      {
        name: "sections",
        type: "repeater",
        fields: [{ name: "heading", type: "text", required: true }],
      },
    ];
    const issues = await validateEntryData(
      { sections: [{ heading: "ok" }, "bad", null, ["x"]] },
      fields,
      { mode: "create" }
    );
    expect(issues).toEqual([
      {
        path: "sections[1]",
        code: "INVALID_TYPE",
        message: "sections rows must be objects.",
      },
      {
        path: "sections[2]",
        code: "INVALID_TYPE",
        message: "sections rows must be objects.",
      },
      {
        path: "sections[3]",
        code: "INVALID_TYPE",
        message: "sections rows must be objects.",
      },
    ]);
  });

  describe("required password on update", () => {
    const fields: ValidatableField[] = [
      { name: "email", type: "email", required: true },
      { name: "password", type: "password", required: true },
    ];

    it("keeps requiring a password on create when left empty", async () => {
      const issues = await validateEntryData(
        { email: "a@b.co", password: "" },
        fields,
        { mode: "create" }
      );
      expect(issues).toEqual([
        {
          path: "password",
          code: "REQUIRED",
          message: "password is required.",
        },
      ]);
    });

    it("treats an empty password on update as 'keep current' (no REQUIRED)", async () => {
      // The admin edit form seeds a write-only password with "" to mean
      // "leave the stored hash"; hashPasswordFieldValues drops it later.
      for (const password of ["", "   ", undefined]) {
        const issues = await validateEntryData(
          { email: "a@b.co", password },
          fields,
          { mode: "update" }
        );
        expect(issues).toEqual([]);
      }
    });

    it("still validates a non-empty password on update", async () => {
      const constrained: ValidatableField[] = [
        {
          name: "password",
          type: "password",
          required: true,
          minLength: 8,
        },
      ];
      const issues = await validateEntryData(
        { password: "short" },
        constrained,
        { mode: "update" }
      );
      expect(issues).toEqual([
        {
          path: "password",
          code: "TOO_SHORT",
          message: "password must be at least 8 characters.",
        },
      ]);
    });
  });

  describe("scalar vs list select/radio", () => {
    const scalar: ValidatableField[] = [
      {
        name: "status",
        type: "select",
        options: [{ value: "draft" }, { value: "published" }],
      },
    ];
    const multi: ValidatableField[] = [
      {
        name: "status",
        type: "select",
        hasMany: true,
        options: [{ value: "draft" }, { value: "published" }],
      },
    ];

    it("rejects an array for a scalar select even when every element is valid", async () => {
      const issues = await validateEntryData(
        { status: ["draft", "published"] },
        scalar,
        { mode: "create" }
      );
      expect(issues).toEqual([
        {
          path: "status",
          code: "INVALID_TYPE",
          message: "status must be a single option.",
        },
      ]);
    });

    it("accepts a single valid option for a scalar select", async () => {
      const issues = await validateEntryData({ status: "draft" }, scalar, {
        mode: "create",
      });
      expect(issues).toEqual([]);
    });

    it("requires an array for a hasMany select and validates each element", async () => {
      const scalarInput = await validateEntryData({ status: "draft" }, multi, {
        mode: "create",
      });
      expect(scalarInput).toEqual([
        {
          path: "status",
          code: "INVALID_TYPE",
          message: "status must be a list.",
        },
      ]);
      const ok = await validateEntryData(
        { status: ["draft", "published"] },
        multi,
        { mode: "create" }
      );
      expect(ok).toEqual([]);
      const bad = await validateEntryData(
        { status: ["draft", "nope"] },
        multi,
        {
          mode: "create",
        }
      );
      expect(bad).toEqual([
        {
          path: "status[1]",
          code: "INVALID_OPTION",
          message: "status must be one of the configured options.",
        },
      ]);
    });
  });
});
