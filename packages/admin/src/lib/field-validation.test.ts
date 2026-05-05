import type { FieldConfig } from "@revnixhq/nextly/config";
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
