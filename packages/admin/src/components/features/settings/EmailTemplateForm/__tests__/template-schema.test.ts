/**
 * A layout row has no subject, and the shipped default layout is seeded with an
 * empty one (`domains/email/services/templates/default-layout.ts`).
 *
 * Requiring a subject of every row therefore made that layout unsaveable — and
 * silently, because the layout editor renders no subject field for the message
 * to attach to. The rule has to know which kind it is validating.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_VALUES, templateSchemaFor } from "../schema";

/** A row that is valid apart from the field under test. */
const base = {
  ...DEFAULT_VALUES,
  name: "Default Layout",
  slug: "default-layout",
  htmlContent: "<html>{{content}}</html>",
};

describe("templateSchemaFor", () => {
  it("accepts a layout row with the empty subject it is seeded with", () => {
    const result = templateSchemaFor(true).safeParse({ ...base, subject: "" });

    expect(result.success).toBe(true);
  });

  it("still requires a subject of a message, which is the point of the rule", () => {
    // The control. Without it, a schema that dropped the requirement entirely
    // would pass the test above just as well.
    const result = templateSchemaFor(false).safeParse({ ...base, subject: "" });

    expect(result.success).toBe(false);
    expect(
      result.success ? [] : result.error.issues.map(i => i.message)
    ).toContain("Email subject is required");
  });

  it("still caps a layout's subject, rather than dropping the field's rules", () => {
    const result = templateSchemaFor(true).safeParse({
      ...base,
      subject: "x".repeat(501),
    });

    expect(result.success).toBe(false);
  });
});

describe("the copies and the description", () => {
  const message = { ...base, subject: "Hi" };
  const parse = (over: Record<string, unknown>) =>
    templateSchemaFor(false).safeParse({ ...message, ...over });

  it("accepts an address with a name, as the server sends it", () => {
    expect(parse({ cc: ["Ops <ops@example.com>"] }).success).toBe(true);
    expect(parse({ bcc: ["ops@example.com"] }).success).toBe(true);
  });

  it("refuses what isn't one sendable address", () => {
    expect(parse({ cc: ["not an address"] }).success).toBe(false);
    expect(parse({ cc: ["a@example.com, b@example.com"] }).success).toBe(false);
    // A line break would let the value write a header of its own.
    expect(parse({ cc: ["a@example.com\nBcc: b@example.com"] }).success).toBe(
      false
    );
  });

  it("sets no length on the description, which an owner may write at any length", () => {
    expect(parse({ description: "x".repeat(2000) }).success).toBe(true);
  });
});
