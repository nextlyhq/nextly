/**
 * Guards the claim `ENFORCED_VALIDATION_RULES` makes.
 *
 * The field editor narrows what it offers to this list, so a rule listed here
 * and never implemented becomes a control that stores a bound nothing reads —
 * worse than no control, because the author believes the rule is in force. The
 * only assertion that separates a real entry from a decorative one is that
 * setting the rule CHANGES what the generated schema accepts.
 *
 * `message` is the exception and is asserted differently: it does not decide
 * whether a value passes, it decides what the failure says.
 */
import { describe, expect, it } from "vitest";

import type { FormField } from "../types";

import {
  ENFORCED_VALIDATION_RULES,
  generateZodSchema,
} from "./generate-schema";

/** One field, with whatever validation the case under test needs. */
function field(overrides: Record<string, unknown>): FormField {
  return {
    id: "f1",
    name: "f1",
    label: "Field",
    type: "text",
    required: false,
    ...overrides,
  } as FormField;
}

/** Whether the generated schema accepts a value for that one field. */
function accepts(f: FormField, value: unknown): boolean {
  return generateZodSchema([f]).safeParse({ [f.name]: value }).success;
}

describe("ENFORCED_VALIDATION_RULES — every entry actually bites", () => {
  it("minLength rejects a value the unbounded field accepts", () => {
    expect(accepts(field({}), "ab")).toBe(true);
    expect(accepts(field({ validation: { minLength: 5 } }), "ab")).toBe(false);
  });

  it("maxLength rejects a value the unbounded field accepts", () => {
    expect(accepts(field({}), "abcdef")).toBe(true);
    expect(accepts(field({ validation: { maxLength: 3 } }), "abcdef")).toBe(
      false
    );
  });

  it("pattern rejects a value the unbounded field accepts", () => {
    expect(accepts(field({}), "AB")).toBe(true);
    expect(accepts(field({ validation: { pattern: "^[a-z]+$" } }), "AB")).toBe(
      false
    );
  });

  it("min rejects a value the unbounded number accepts", () => {
    const plain = field({ type: "number" });
    expect(accepts(plain, 1)).toBe(true);
    expect(accepts(field({ type: "number", validation: { min: 5 } }), 1)).toBe(
      false
    );
  });

  it("max rejects a value the unbounded number accepts", () => {
    expect(accepts(field({ type: "number" }), 9)).toBe(true);
    expect(accepts(field({ type: "number", validation: { max: 5 } }), 9)).toBe(
      false
    );
  });

  it("message changes what the failure SAYS, which is its whole job", () => {
    const custom = field({
      validation: { minLength: 5, errorMessage: "Too short, sorry" },
    });
    const result = generateZodSchema([custom]).safeParse({ f1: "ab" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("Too short, sorry");
    }
  });

  it("MUST NOT list a rule the generator ignores", () => {
    // The control for all of the above, and the reason this file exists: core
    // offers a textarea `minRows`/`maxRows`, and this generator has no clause
    // for them. Listing one would put an inert control in the editor.
    expect(ENFORCED_VALIDATION_RULES).not.toContain("minRows");
    expect(ENFORCED_VALIDATION_RULES).not.toContain("maxRows");
  });

  it("MUST NOT list `required` — it is offered by its own control", () => {
    expect(ENFORCED_VALIDATION_RULES).not.toContain("required");
  });
});
