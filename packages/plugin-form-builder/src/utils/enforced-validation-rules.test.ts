/**
 * Guards the claim `ENFORCED_VALIDATION_RULES` makes, per field type.
 *
 * The field editor narrows what it offers to this table, so a rule listed for a
 * type and not implemented for it becomes a control that stores a bound nothing
 * reads — worse than no control, because the author believes the rule is in
 * force. The only assertion that separates a real entry from a decorative one
 * is that setting the rule CHANGES what the generated schema accepts for THAT
 * type.
 *
 * The test runs in both directions, and the second half is the one that matters
 * most. Asserting only that listed rules bite would pass on a table that listed
 * nothing at all. So every rule a type ACCEPTS but this table omits is asserted
 * to be genuinely unenforced — which is what makes the omission a finding about
 * the runtime rather than an oversight in the table.
 *
 * `message` is excluded from both halves and asserted separately: it does not
 * decide whether a value passes, only what the failure says.
 */
import type { FieldValidationRule } from "nextly/field-catalog";
import { validationRulesForFieldType } from "nextly/field-catalog";
import { describe, expect, it } from "vitest";

import type { FormField, FormFieldType } from "../types";
import { BUILT_IN_FORM_FIELD_TYPES } from "../types";

import { ENFORCED_VALIDATION_RULES } from "./enforced-validation";
import { generateZodSchema } from "./generate-schema";

/** A value each type accepts when nothing is bounding it. */
const ACCEPTED: Record<FormFieldType, unknown> = {
  text: "abcdef",
  email: "user@example.com",
  number: 4,
  phone: "+15551234567",
  url: "https://example.com",
  textarea: "abcdef",
  select: "abcdef",
  checkbox: true,
  radio: "abcdef",
  file: "abcdef",
  date: "2026-01-01",
  time: "10:00",
  hidden: "abcdef",
};

/**
 * A bound that the value above would fail, for each rule that decides
 * acceptance. Chosen far outside the probe value so a rule cannot pass by
 * coincidence.
 */
const REJECTING_BOUND: Record<string, Record<string, unknown>> = {
  minLength: { minLength: 50 },
  maxLength: { maxLength: 2 },
  pattern: { pattern: "^ZZZ$" },
  min: { min: 100 },
  max: { max: -100 },
  minRows: { minRows: 50 },
  maxRows: { maxRows: 1 },
};

function field(
  type: FormFieldType,
  validation?: Record<string, unknown>,
  required = false
) {
  return {
    id: "f1",
    name: "f1",
    label: "Field",
    type,
    required,
    ...(validation ? { validation } : {}),
    // Choice types need something to choose from before a value is legal.
    ...(type === "select" || type === "radio"
      ? { options: [{ label: "A", value: "abcdef" }] }
      : {}),
  } as unknown as FormField;
}

function accepts(f: FormField, value: unknown): boolean {
  return generateZodSchema([f]).safeParse({ [f.name]: value }).success;
}

/** Rules that decide acceptance, so `message` never reaches the probes. */
function decidingRules(rules: readonly FieldValidationRule[]) {
  return rules.filter(r => r !== "message" && r !== "required");
}

describe("every listed rule bites, for the type it is listed under", () => {
  for (const type of BUILT_IN_FORM_FIELD_TYPES) {
    const listed = decidingRules(ENFORCED_VALIDATION_RULES[type]);
    if (listed.length === 0) continue;

    for (const rule of listed) {
      it(`${type}: ${rule} rejects a value the unbounded field accepts`, () => {
        const bound = REJECTING_BOUND[rule];
        expect(bound, `no probe defined for ${rule}`).toBeDefined();
        // The control: without the rule, this exact value passes. Without it,
        // a type that rejected the value for some unrelated reason would look
        // like a rule that bites.
        expect(accepts(field(type), ACCEPTED[type])).toBe(true);
        expect(accepts(field(type, bound), ACCEPTED[type])).toBe(false);
      });
    }
  }
});

describe("every omitted rule is genuinely unenforced", () => {
  // This is what stops the table from silently under-claiming. Core says these
  // rules apply to the type; this runtime does not read them, and that is the
  // reason the editor must not offer them.
  for (const type of BUILT_IN_FORM_FIELD_TYPES) {
    const listed = new Set<string>(ENFORCED_VALIDATION_RULES[type]);
    const omitted = decidingRules(validationRulesForFieldType(type)).filter(
      r => !listed.has(r)
    );
    if (omitted.length === 0) continue;

    for (const rule of omitted) {
      it(`${type}: ${rule} is accepted by core but ignored here`, () => {
        const bound = REJECTING_BOUND[rule];
        expect(bound, `no probe defined for ${rule}`).toBeDefined();
        // Still accepted WITH the bound set — so listing it would have put an
        // inert control in the editor.
        expect(accepts(field(type, bound), ACCEPTED[type])).toBe(true);
      });
    }
  }
});

describe("the message rule", () => {
  it("changes what the failure SAYS, which is its whole job", () => {
    const custom = field("text", {
      minLength: 5,
      errorMessage: "Too short, sorry",
    });
    const result = generateZodSchema([custom]).safeParse({ f1: "ab" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("Too short, sorry");
    }
  });

  it("reaches the emitted issue for every type, observed not restated", () => {
    // Reading `ENFORCED_VALIDATION_RULES` back here would assert the table
    // against itself: the generator could stop consulting `errorMessage`
    // entirely and every assertion would stay green. So this drives the
    // generator and reads the message off the issue it produces.
    const CUSTOM = "Say it this way instead";

    for (const type of BUILT_IN_FORM_FIELD_TYPES) {
      // A type with a bound of its own fails by breaching it; one without
      // fails by being required and empty. Candidates rather than a
      // per-type table, so a generator that rejects differently is still
      // exercised instead of silently skipped.
      const deciding = decidingRules(ENFORCED_VALIDATION_RULES[type]);
      const bound = deciding[0] ? REJECTING_BOUND[deciding[0]] : undefined;
      // The empty value has to be in the SHAPE the type accepts. Handing `""`
      // to a checkbox produces a type error rather than a required failure, so
      // the candidate never reaches the message path and the observation would
      // be of coercion instead of the rule under test.
      const empty = typeof ACCEPTED[type] === "boolean" ? false : "";
      const candidates: { f: FormField; v: unknown }[] = bound
        ? [
            {
              f: field(type, { ...bound, errorMessage: CUSTOM }),
              v: ACCEPTED[type],
            },
          ]
        : [
            { f: field(type, { errorMessage: CUSTOM }, true), v: empty },
            { f: field(type, { errorMessage: CUSTOM }, true), v: undefined },
          ];

      const failures = candidates
        .map(c => generateZodSchema([c.f]).safeParse({ f1: c.v }))
        .filter(r => !r.success);

      // The population assertion. Without it a type whose every candidate
      // PASSED would contribute no observation, and the loop would report
      // success having checked nothing for it.
      expect(
        failures.length,
        `no candidate input fails for type "${type}", so its message is unobserved`
      ).toBeGreaterThan(0);

      // SOME failure rather than every one, and the difference is not
      // looseness. An input of the wrong TYPE fails before any rule is
      // reached — `undefined` against a checkbox is rejected by `z.boolean()`
      // itself — and zod's own text is correct there. What justifies listing
      // `message` for a type is that a failure of its RULES carries the
      // author's words, which is what this asserts. A generator that stopped
      // consulting `errorMessage` would satisfy no candidate and fail here.
      const carried = failures.some(
        r => !r.success && r.error.issues.some(i => i.message === CUSTOM)
      );
      expect(
        carried,
        `type "${type}" never surfaced the custom message; issues were ` +
          JSON.stringify(
            failures.flatMap(r =>
              r.success ? [] : r.error.issues.map(i => i.message)
            )
          )
      ).toBe(true);
    }
  });

  it("never lists `required` — it is offered by its own control", () => {
    for (const type of BUILT_IN_FORM_FIELD_TYPES) {
      expect(ENFORCED_VALIDATION_RULES[type]).not.toContain("required");
    }
  });
});
