/**
 * Issue 6 empirical fixes — Vitest coverage for the four validation
 * gaps the matrix flagged as red:
 *
 *  1. Email field's `validation.minLength` / `validation.maxLength` were
 *     ignored — emails accepted any length.
 *  2. Number field's `validation.message` was ignored on min/max — the
 *     generic "Must be at least N" / "Must be at most N" always won.
 *  3. RichText `required: true` was a silent no-op — `z.unknown()` skips
 *     the required gate. Now wraps with `isRichTextEmpty` refine.
 *  4. RichText / JSON `defaultValue` was hardcoded to null in
 *     `getDefaultValues`, ignoring developer-set defaults. Verified
 *     elsewhere via the form layer.
 *
 */
import type { FieldConfig } from "nextly/config";
import { describe, it, expect } from "vitest";

import { generateClientSchema, isRichTextEmpty } from "./field-validation";

// ────────────────────────────────────────────────────────────────────────
// Email length wiring
// ────────────────────────────────────────────────────────────────────────

describe("Email field — minLength / maxLength wiring (Issue 6)", () => {
  it("accepts any email length when no length rules set", () => {
    const schema = generateClientSchema([
      { type: "email", name: "email" } as unknown as FieldConfig,
    ]);
    const ok = schema.safeParse({ email: "a@b.co" });
    expect(ok.success).toBe(true);
  });

  it("rejects emails shorter than validation.minLength", () => {
    const schema = generateClientSchema([
      {
        type: "email",
        name: "email",
        validation: { minLength: 12 },
      } as unknown as FieldConfig,
    ]);
    const bad = schema.safeParse({ email: "a@b.co" });
    expect(bad.success).toBe(false);
  });

  it("rejects emails longer than validation.maxLength", () => {
    const schema = generateClientSchema([
      {
        type: "email",
        name: "email",
        validation: { maxLength: 10 },
      } as unknown as FieldConfig,
    ]);
    const bad = schema.safeParse({
      email: "very-long-email-address@example.com",
    });
    expect(bad.success).toBe(false);
  });

  it("composes length rules with the built-in email format check", () => {
    const schema = generateClientSchema([
      {
        type: "email",
        name: "email",
        validation: { minLength: 5, maxLength: 50 },
      } as unknown as FieldConfig,
    ]);
    // Right length but wrong format → still fails.
    const bad = schema.safeParse({ email: "not-an-email" });
    expect(bad.success).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Number custom min/max message
// ────────────────────────────────────────────────────────────────────────

describe("Number field — custom min/max error message (Issue 6)", () => {
  it("uses validation.message on the min violation", () => {
    const schema = generateClientSchema([
      {
        type: "number",
        name: "age",
        required: true,
        validation: { min: 18, message: "You must be at least 18" },
      } as unknown as FieldConfig,
    ]);
    const bad = schema.safeParse({ age: 12 });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      const issue = bad.error.issues.find(i => i.path[0] === "age");
      expect(issue?.message).toBe("You must be at least 18");
    }
  });

  it("uses validation.message on the max violation", () => {
    const schema = generateClientSchema([
      {
        type: "number",
        name: "rating",
        required: true,
        validation: { max: 5, message: "Rating cannot exceed 5" },
      } as unknown as FieldConfig,
    ]);
    const bad = schema.safeParse({ rating: 11 });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      const issue = bad.error.issues.find(i => i.path[0] === "rating");
      expect(issue?.message).toBe("Rating cannot exceed 5");
    }
  });

  it("falls back to the generic message when validation.message is unset", () => {
    const schema = generateClientSchema([
      {
        type: "number",
        name: "qty",
        required: true,
        validation: { min: 1 },
      } as unknown as FieldConfig,
    ]);
    const bad = schema.safeParse({ qty: 0 });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      const issue = bad.error.issues.find(i => i.path[0] === "qty");
      expect(issue?.message).toBe("Must be at least 1");
    }
  });
});

// ────────────────────────────────────────────────────────────────────────
// RichText required heuristic
// ────────────────────────────────────────────────────────────────────────

describe("isRichTextEmpty — empty-state heuristic", () => {
  it("treats null / undefined as empty", () => {
    expect(isRichTextEmpty(null)).toBe(true);
    expect(isRichTextEmpty(undefined)).toBe(true);
  });

  it("treats whitespace-only HTML as empty", () => {
    expect(isRichTextEmpty("")).toBe(true);
    expect(isRichTextEmpty("   ")).toBe(true);
    expect(isRichTextEmpty("<p></p>")).toBe(true);
    expect(isRichTextEmpty("<p>  </p>")).toBe(true);
    expect(isRichTextEmpty("<br/>")).toBe(true);
  });

  it("treats Lexical empty-root as empty", () => {
    expect(isRichTextEmpty({ root: { children: [] } })).toBe(true);
    // Single empty paragraph is the default Lexical "empty" shape.
    expect(
      isRichTextEmpty({
        root: { children: [{ type: "paragraph", children: [] }] },
      })
    ).toBe(true);
  });

  it("treats Lexical with content as non-empty", () => {
    expect(
      isRichTextEmpty({
        root: {
          children: [
            {
              type: "paragraph",
              children: [{ type: "text", text: "hi" }],
            },
          ],
        },
      })
    ).toBe(false);
  });

  it("treats real HTML content as non-empty", () => {
    expect(isRichTextEmpty("<p>Hello world</p>")).toBe(false);
  });
});

describe("RichText field — required gate (Issue 6)", () => {
  it("blocks submit when required and value is empty (Lexical empty-root)", () => {
    const schema = generateClientSchema([
      {
        type: "richText",
        name: "body",
        required: true,
      } as unknown as FieldConfig,
    ]);
    const bad = schema.safeParse({ body: { root: { children: [] } } });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      const issue = bad.error.issues.find(i => i.path[0] === "body");
      expect(issue?.message).toBe("This field is required");
    }
  });

  it("blocks submit when required and value is null", () => {
    const schema = generateClientSchema([
      {
        type: "richText",
        name: "body",
        required: true,
      } as unknown as FieldConfig,
    ]);
    const bad = schema.safeParse({ body: null });
    expect(bad.success).toBe(false);
  });

  it("accepts when required and value has content", () => {
    const schema = generateClientSchema([
      {
        type: "richText",
        name: "body",
        required: true,
      } as unknown as FieldConfig,
    ]);
    const ok = schema.safeParse({
      body: {
        root: {
          children: [
            { type: "paragraph", children: [{ type: "text", text: "hi" }] },
          ],
        },
      },
    });
    expect(ok.success).toBe(true);
  });

  it("accepts when not required and value is empty", () => {
    const schema = generateClientSchema([
      { type: "richText", name: "body" } as unknown as FieldConfig,
    ]);
    const ok = schema.safeParse({ body: null });
    expect(ok.success).toBe(true);
  });
});
