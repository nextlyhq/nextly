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
