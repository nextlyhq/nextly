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
import { afterEach, describe, expect, it, vi } from "vitest";

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

describe("the table is what the generator reads", () => {
  /**
   * Every assertion above derives BOTH sides from `ENFORCED_VALIDATION_RULES`:
   * it asks the table what to expect and then checks the generator against it.
   * That cannot see the generator ignoring the table — remove a rule and the
   * suite simply stops checking it, and passes either way.
   *
   * These expectations are written out instead. They are the anchor the
   * derived assertions hang from: if the two ever disagree, one of them is
   * wrong and the pair says so, where a single self-referential check would
   * stay quiet.
   *
   * Kept deliberately small. This is not a second copy of the table — it is a
   * handful of cases whose answers were established by running the generator,
   * chosen because each is a rule some OTHER type deliberately omits.
   */
  const ANCHORED: ReadonlyArray<{
    type: FormFieldType;
    rule: string;
    enforced: boolean;
  }> = [
    // `pattern` bites on text, and is deliberately absent from textarea.
    { type: "text", rule: "pattern", enforced: true },
    { type: "textarea", rule: "pattern", enforced: false },
    // Length bounds bite on textarea, and email reads neither.
    { type: "textarea", rule: "minLength", enforced: true },
    { type: "email", rule: "minLength", enforced: false },
    // Numeric bounds bite on number; a date reads its bounds from the field
    // itself, not from `validation`.
    { type: "number", rule: "min", enforced: true },
    { type: "date", rule: "min", enforced: false },
  ];

  for (const { type, rule, enforced } of ANCHORED) {
    it(`${type}: ${rule} is ${enforced ? "enforced" : "ignored"}`, () => {
      const bound = REJECTING_BOUND[rule];
      expect(bound, `no probe defined for ${rule}`).toBeDefined();
      // The control on the probe itself: unbounded, this value passes.
      expect(accepts(field(type), ACCEPTED[type])).toBe(true);
      expect(accepts(field(type, bound), ACCEPTED[type])).toBe(!enforced);
    });
  }

  /**
   * And the anchor agrees with the table, so the two cannot drift apart
   * silently: a rule listed for a type must be one the anchor calls enforced,
   * and vice versa, for every case the anchor covers.
   */
  it("agrees with the table it anchors", () => {
    for (const { type, rule, enforced } of ANCHORED) {
      expect(
        ENFORCED_VALIDATION_RULES[type].includes(
          rule as (typeof ENFORCED_VALIDATION_RULES)[typeof type][number]
        ),
        `${type}/${rule}: the table and the anchor disagree`
      ).toBe(enforced);
    }
  });
});

describe("the generator follows the table, rather than agreeing with it", () => {
  /**
   * Whether the generator's answers MOVE with the table — which nothing above
   * can see.
   *
   * Every other assertion in this file states what the generator accepts. A
   * generator that decided each type in a hand-written branch accepts exactly
   * the same values, so all of them hold against an implementation that never
   * reads the table at all — the anchored block included, since its six
   * outcomes are outcomes either implementation produces. Agreement is not
   * derivation.
   *
   * What separates the two is the dependency between the answers, not any one
   * of them. So these substitute a table differing in exactly one row, and
   * read the generator's answer for that row back.
   *
   * Both directions are asserted and neither alone would do: dropping a rule
   * and watching it stop biting also passes for a generator that applies
   * nothing, and adding one also passes for a generator that applies
   * everything.
   */

  /** `generateZodSchema`, built against a table that says this instead. */
  async function generatorReading(
    table: Record<FormFieldType, readonly FieldValidationRule[]>
  ) {
    vi.resetModules();
    vi.doMock("./enforced-validation", async importOriginal => ({
      ...(await importOriginal<typeof import("./enforced-validation")>()),
      ENFORCED_VALIDATION_RULES: table,
    }));
    const { generateZodSchema: generate } = await import("./generate-schema");
    return (f: FormField, value: unknown) =>
      generate([f]).safeParse({ [f.name]: value }).success;
  }

  afterEach(() => {
    vi.doUnmock("./enforced-validation");
    vi.resetModules();
  });

  it("stops applying a rule its type's row stops listing", async () => {
    const substituted = await generatorReading({
      ...ENFORCED_VALIDATION_RULES,
      text: ["minLength", "maxLength", "message"],
    });

    // The control, and this direction needs one. A substitution that never
    // reached the generator would leave it reading no rules for the type, and
    // "the dropped rule stopped biting" would be true for the wrong reason.
    // A rule the row KEEPS must still bite, which distinguishes a table that
    // arrived and changed from one that did not arrive.
    expect(substituted(field("text", { minLength: 50 }), ACCEPTED.text)).toBe(
      false
    );
    // The observation: the row no longer lists `pattern`, so the bound the
    // field still carries is no longer read.
    expect(
      substituted(field("text", { pattern: "^ZZZ$" }), ACCEPTED.text)
    ).toBe(true);
  });

  it("starts applying a rule its type's row starts listing", async () => {
    // `textarea` is the type to grow a rule, because its schema body is
    // `text`'s exactly: the real table's row is the only reason `pattern` is
    // inert there, so a generator ignoring the table cannot follow this.
    const substituted = await generatorReading({
      ...ENFORCED_VALIDATION_RULES,
      textarea: ["minLength", "maxLength", "pattern", "message"],
    });

    // Self-controlling, unlike the direction above: every way the substitution
    // could fail to arrive — the real table, or none — leaves `pattern` inert
    // and yields the opposite answer here.
    expect(
      substituted(field("textarea", { pattern: "^ZZZ$" }), ACCEPTED.textarea)
    ).toBe(false);
  });

  it("follows the table where numeric bounds are read, too", async () => {
    // A second and separate read of the table. Numeric bounds go through their
    // own applier map, so a hand-written number branch — reinstated alone —
    // would satisfy both probes above while ignoring the row that governs it.
    const substituted = await generatorReading({
      ...ENFORCED_VALIDATION_RULES,
      number: ["max", "message"],
    });

    // The kept rule, controlling the arrival of the table as before.
    expect(substituted(field("number", { max: -100 }), ACCEPTED.number)).toBe(
      false
    );
    expect(substituted(field("number", { min: 100 }), ACCEPTED.number)).toBe(
      true
    );
  });
});
