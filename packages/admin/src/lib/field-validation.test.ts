import type { FieldConfig } from "nextly/config";
import { describe, it, expect } from "vitest";

import { generateClientSchema } from "./field-validation";

describe("generateClientSchema — validation.pattern enforcement (Task 3 PR 8)", () => {
  it("rejects values that don't match validation.pattern", () => {
    const schema = generateClientSchema([
      {
        type: "text",
        name: "slug",
        required: true,
        validation: {
          pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
          message: "Slug must be lowercase with hyphens only",
        },
      } as unknown as FieldConfig,
    ]);

    const ok = schema.safeParse({ slug: "valid-slug" });
    expect(ok.success).toBe(true);

    const bad = schema.safeParse({ slug: "Invalid Slug" });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      const issue = bad.error.issues.find(i => i.path[0] === "slug");
      expect(issue?.message).toBe("Slug must be lowercase with hyphens only");
    }
  });

  it("uses fallback message when validation.message is omitted", () => {
    const schema = generateClientSchema([
      {
        type: "text",
        name: "code",
        required: true,
        validation: { pattern: "^[A-Z]{3}$" },
      } as unknown as FieldConfig,
    ]);

    const bad = schema.safeParse({ code: "abc" });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues[0]?.message).toBe("Invalid format");
    }
  });

  it("ignores a malformed pattern instead of throwing at schema build", () => {
    // An unbalanced parenthesis would normally crash new RegExp(pattern).
    expect(() =>
      generateClientSchema([
        {
          type: "text",
          name: "weird",
          required: true,
          validation: { pattern: "([unbalanced" },
        } as unknown as FieldConfig,
      ])
    ).not.toThrow();
  });

  it("applies pattern to each item when text field has hasMany", () => {
    const schema = generateClientSchema([
      {
        type: "text",
        name: "tags",
        required: true,
        hasMany: true,
        validation: {
          pattern: "^[a-z]+$",
          message: "Tags must be lowercase letters",
        },
      } as unknown as FieldConfig,
    ]);

    const ok = schema.safeParse({ tags: ["alpha", "beta"] });
    expect(ok.success).toBe(true);

    const bad = schema.safeParse({ tags: ["alpha", "Beta1"] });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues[0]?.message).toBe(
        "Tags must be lowercase letters"
      );
    }
  });

  it("applies pattern on textarea fields too", () => {
    const schema = generateClientSchema([
      {
        type: "textarea",
        name: "bio",
        required: true,
        validation: {
          pattern: "^[A-Za-z .]+$",
          message: "Letters, spaces and periods only",
        },
      } as unknown as FieldConfig,
    ]);

    const ok = schema.safeParse({ bio: "John A. Doe" });
    expect(ok.success).toBe(true);

    const bad = schema.safeParse({ bio: "Hello123" });
    expect(bad.success).toBe(false);
  });
});

describe("Task 5 PR 7 — F1: validation.pattern on optional empty values", () => {
  it("optional text field with pattern accepts empty string", () => {
    const schema = generateClientSchema([
      {
        type: "text",
        name: "code",
        // not required
        validation: { pattern: "^[A-Z]{3}$", message: "Three caps" },
      } as unknown as FieldConfig,
    ]);
    expect(schema.safeParse({ code: "" }).success).toBe(true);
  });

  it("optional text field with pattern rejects non-empty bad value", () => {
    const schema = generateClientSchema([
      {
        type: "text",
        name: "code",
        validation: { pattern: "^[A-Z]{3}$", message: "Three caps" },
      } as unknown as FieldConfig,
    ]);
    const result = schema.safeParse({ code: "abc" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("Three caps");
    }
  });

  it("required text field with pattern still rejects empty string", () => {
    const schema = generateClientSchema([
      {
        type: "text",
        name: "code",
        required: true,
        validation: { pattern: "^[A-Z]{3}$", message: "Three caps" },
      } as unknown as FieldConfig,
    ]);
    expect(schema.safeParse({ code: "" }).success).toBe(false);
  });

  it("optional textarea with pattern accepts empty string", () => {
    const schema = generateClientSchema([
      {
        type: "textarea",
        name: "bio",
        validation: { pattern: "^[A-Za-z ]+$" },
      } as unknown as FieldConfig,
    ]);
    expect(schema.safeParse({ bio: "" }).success).toBe(true);
  });
});

describe("Task 5 PR 7 — Pattern coverage on password and code", () => {
  it("password field rejects on pattern mismatch", () => {
    const schema = generateClientSchema([
      {
        type: "password",
        name: "pwd",
        required: true,
        validation: { pattern: "^.{12,}$", message: "Min 12 chars" },
      } as unknown as FieldConfig,
    ]);
    expect(schema.safeParse({ pwd: "short" }).success).toBe(false);
    expect(schema.safeParse({ pwd: "longenoughpassword" }).success).toBe(true);
  });

  it("password field with custom message surfaces it on mismatch", () => {
    const schema = generateClientSchema([
      {
        type: "password",
        name: "pwd",
        required: true,
        validation: { pattern: "^[A-Z].*[0-9]$", message: "Cap + digit" },
      } as unknown as FieldConfig,
    ]);
    const bad = schema.safeParse({ pwd: "abc" });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues[0]?.message).toBe("Cap + digit");
    }
  });

  it("code field rejects on pattern mismatch", () => {
    const schema = generateClientSchema([
      {
        type: "code",
        name: "color",
        required: true,
        validation: { pattern: "^#[0-9a-fA-F]{6}$", message: "Hex required" },
      } as unknown as FieldConfig,
    ]);
    expect(schema.safeParse({ color: "red" }).success).toBe(false);
    expect(schema.safeParse({ color: "#ff0000" }).success).toBe(true);
  });

  it("optional code field with pattern accepts empty string (F1 applies here too)", () => {
    const schema = generateClientSchema([
      {
        type: "code",
        name: "color",
        validation: { pattern: "^#[0-9a-fA-F]{6}$" },
      } as unknown as FieldConfig,
    ]);
    expect(schema.safeParse({ color: "" }).success).toBe(true);
  });
});

describe("generateClientSchema — optional fields tolerate empty string", () => {
  it("optional email field accepts an empty string", () => {
    const schema = generateClientSchema([
      {
        type: "email",
        name: "supportEmail",
        required: false,
      } as unknown as FieldConfig,
    ]);
    expect(schema.safeParse({ supportEmail: "" }).success).toBe(true);
  });

  it("optional text field with minLength accepts an empty string", () => {
    const schema = generateClientSchema([
      {
        type: "text",
        name: "nickname",
        required: false,
        validation: { minLength: 3 },
      } as unknown as FieldConfig,
    ]);
    expect(schema.safeParse({ nickname: "" }).success).toBe(true);
  });

  it("optional hasMany select accepts an empty array, not a stray string", () => {
    const schema = generateClientSchema([
      {
        type: "select",
        name: "channels",
        required: false,
        hasMany: true,
        options: [{ label: "Web", value: "web" }],
      } as unknown as FieldConfig,
    ]);
    expect(schema.safeParse({ channels: [] }).success).toBe(true);
    expect(schema.safeParse({ channels: undefined }).success).toBe(true);
    // The empty sentinel for an array field is [], never "".
    expect(schema.safeParse({ channels: "" }).success).toBe(false);
  });

  it("required email field still rejects an empty string", () => {
    const schema = generateClientSchema([
      {
        type: "email",
        name: "supportEmail",
        required: true,
      } as unknown as FieldConfig,
    ]);
    expect(schema.safeParse({ supportEmail: "" }).success).toBe(false);
  });

  it("optional email field still rejects a malformed non-empty value", () => {
    const schema = generateClientSchema([
      {
        type: "email",
        name: "supportEmail",
        required: false,
      } as unknown as FieldConfig,
    ]);
    expect(schema.safeParse({ supportEmail: "not-an-email" }).success).toBe(
      false
    );
  });
});

describe("generateClientSchema — repeater row bounds (minRows / maxRows)", () => {
  it("rejects a text hasMany list below minRows with the items wording", () => {
    const schema = generateClientSchema([
      {
        type: "text",
        name: "tags",
        required: true,
        hasMany: true,
        validation: { minRows: 3 },
      } as unknown as FieldConfig,
    ]);
    expect(schema.safeParse({ tags: ["a", "b"] }).success).toBe(false);
    const bad = schema.safeParse({ tags: ["a", "b"] });
    if (!bad.success) {
      expect(bad.error.issues[0]?.message).toBe("Minimum 3 items required");
    }
  });

  it("accepts a text hasMany list once minRows is met", () => {
    const schema = generateClientSchema([
      {
        type: "text",
        name: "tags",
        required: true,
        hasMany: true,
        validation: { minRows: 2 },
      } as unknown as FieldConfig,
    ]);
    expect(schema.safeParse({ tags: ["a", "b"] }).success).toBe(true);
  });

  it("rejects a text hasMany list above maxRows", () => {
    const schema = generateClientSchema([
      {
        type: "text",
        name: "tags",
        required: true,
        hasMany: true,
        validation: { maxRows: 2 },
      } as unknown as FieldConfig,
    ]);
    const bad = schema.safeParse({ tags: ["a", "b", "c"] });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues[0]?.message).toBe("Maximum 2 items allowed");
    }
  });

  it("rejects a number hasMany list below minRows with the items wording", () => {
    // Every list-bearing field type words its row bounds the same way;
    // number hasMany is not special.
    const schema = generateClientSchema([
      {
        type: "number",
        name: "scores",
        required: true,
        hasMany: true,
        validation: { minRows: 3 },
      } as unknown as FieldConfig,
    ]);
    const bad = schema.safeParse({ scores: [1, 2] });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues[0]?.message).toBe("Minimum 3 items required");
    }
  });

  it("rejects a number hasMany list above maxRows with the items wording", () => {
    const schema = generateClientSchema([
      {
        type: "number",
        name: "scores",
        required: true,
        hasMany: true,
        validation: { maxRows: 3 },
      } as unknown as FieldConfig,
    ]);
    const bad = schema.safeParse({ scores: [1, 2, 3, 4] });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues[0]?.message).toBe("Maximum 3 items allowed");
    }
  });

  it("rejects a repeater below minRows with the items wording", () => {
    const schema = generateClientSchema([
      {
        type: "repeater",
        name: "rows",
        required: true,
        validation: { minRows: 2 },
        fields: [{ type: "text", name: "label", required: true }],
      } as unknown as FieldConfig,
    ]);
    const bad = schema.safeParse({ rows: [{ label: "a" }] });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues[0]?.message).toBe("Minimum 2 items required");
    }
  });

  it("accepts a repeater at minRows and still validates nested fields", () => {
    const schema = generateClientSchema([
      {
        type: "repeater",
        name: "rows",
        required: true,
        validation: { minRows: 1 },
        fields: [{ type: "text", name: "label", required: true }],
      } as unknown as FieldConfig,
    ]);
    expect(
      schema.safeParse({ rows: [{ label: "a" }, { label: "b" }] }).success
    ).toBe(true);
    // The row bound passing must not mute the item's own required rule.
    const bad = schema.safeParse({ rows: [{ label: "" }] });
    expect(bad.success).toBe(false);
  });

  it("rejects a relationship hasMany list below minRows with the relationships wording", () => {
    const schema = generateClientSchema([
      {
        type: "relationship",
        name: "authors",
        required: true,
        hasMany: true,
        relationTo: "users",
        validation: { minRows: 2 },
      } as unknown as FieldConfig,
    ]);
    const bad = schema.safeParse({ authors: ["u-1"] });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues[0]?.message).toBe(
        "Minimum 2 relationships required"
      );
    }
  });

  it("rejects an upload hasMany list below minRows with the files wording", () => {
    const schema = generateClientSchema([
      {
        type: "upload",
        name: "gallery",
        required: true,
        hasMany: true,
        validation: { minRows: 2 },
      } as unknown as FieldConfig,
    ]);
    const bad = schema.safeParse({ gallery: ["file-1"] });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues[0]?.message).toBe("Minimum 2 files required");
    }
  });
});

describe("generateClientSchema — string length bound messages", () => {
  it("words text bounds without a subject prefix", () => {
    const schema = generateClientSchema([
      {
        type: "text",
        name: "title",
        required: true,
        validation: { minLength: 3, maxLength: 5 },
      } as unknown as FieldConfig,
    ]);
    const short = schema.safeParse({ title: "ab" });
    expect(short.success).toBe(false);
    if (!short.success) {
      expect(short.error.issues[0]?.message).toBe(
        "Must be at least 3 characters"
      );
    }
    const long = schema.safeParse({ title: "toolong" });
    expect(long.success).toBe(false);
    if (!long.success) {
      expect(long.error.issues[0]?.message).toBe(
        "Must be at most 5 characters"
      );
    }
  });

  it("words textarea bounds identically to text", () => {
    const schema = generateClientSchema([
      {
        type: "textarea",
        name: "summary",
        required: true,
        validation: { minLength: 3 },
      } as unknown as FieldConfig,
    ]);
    const bad = schema.safeParse({ summary: "ab" });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues[0]?.message).toBe(
        "Must be at least 3 characters"
      );
    }
  });

  it("words code bounds identically to text", () => {
    const schema = generateClientSchema([
      {
        type: "code",
        name: "snippet",
        required: true,
        validation: { maxLength: 4 },
      } as unknown as FieldConfig,
    ]);
    const bad = schema.safeParse({ snippet: "toolong" });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues[0]?.message).toBe("Must be at most 4 characters");
    }
  });

  it("words password bounds with the Password subject", () => {
    const schema = generateClientSchema([
      {
        type: "password",
        name: "secret",
        required: true,
        validation: { minLength: 8 },
      } as unknown as FieldConfig,
    ]);
    const bad = schema.safeParse({ secret: "short" });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues[0]?.message).toBe(
        "Password must be at least 8 characters"
      );
    }
  });

  it("words email bounds with the Email subject", () => {
    const schema = generateClientSchema([
      {
        type: "email",
        name: "supportEmail",
        required: true,
        validation: { minLength: 12 },
      } as unknown as FieldConfig,
    ]);
    const bad = schema.safeParse({ supportEmail: "a@b.co" });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues[0]?.message).toBe(
        "Email must be at least 12 characters"
      );
    }
  });

  it("words per-item bounds in a text hasMany with the Each item subject", () => {
    const schema = generateClientSchema([
      {
        type: "text",
        name: "tags",
        required: true,
        hasMany: true,
        validation: { minLength: 2 },
      } as unknown as FieldConfig,
    ]);
    const bad = schema.safeParse({ tags: ["a"] });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues[0]?.message).toBe(
        "Each item must be at least 2 characters"
      );
    }
  });
});

describe("generateClientSchema — numeric bound edges", () => {
  it("enforces min: 0, so zero is a bound and not a skipped setting", () => {
    const schema = generateClientSchema([
      {
        type: "number",
        name: "qty",
        required: true,
        validation: { min: 0 },
      } as unknown as FieldConfig,
    ]);
    const bad = schema.safeParse({ qty: -1 });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues[0]?.message).toBe("Must be at least 0");
    }
    expect(schema.safeParse({ qty: 0 }).success).toBe(true);
  });

  it("enforces per-item min in a number hasMany with the Each value subject", () => {
    const schema = generateClientSchema([
      {
        type: "number",
        name: "scores",
        required: true,
        hasMany: true,
        validation: { min: 2 },
      } as unknown as FieldConfig,
    ]);
    const bad = schema.safeParse({ scores: [1, 5] });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues[0]?.message).toBe(
        "Each value must be at least 2"
      );
    }
  });

  it("lets validation.message override per-item number bounds too", () => {
    const schema = generateClientSchema([
      {
        type: "number",
        name: "scores",
        required: true,
        hasMany: true,
        validation: { min: 2, message: "Scores are 2..10" },
      } as unknown as FieldConfig,
    ]);
    const bad = schema.safeParse({ scores: [1, 5] });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues[0]?.message).toBe("Scores are 2..10");
    }
  });
});

describe("generateClientSchema — email applies length bounds but not pattern", () => {
  it("accepts a valid email that violates validation.pattern", () => {
    // Email composes the built-in format check with length bounds only.
    // Applying the string pattern rule here would newly reject values the
    // product accepts today, so the email converter stays off that rule.
    const schema = generateClientSchema([
      {
        type: "email",
        name: "supportEmail",
        required: true,
        validation: { pattern: "^x+@x\\.com$" },
      } as unknown as FieldConfig,
    ]);
    const result = schema.safeParse({ supportEmail: "a@b.co" });
    expect(result.success).toBe(true);
  });
});
