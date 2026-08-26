/**
 * Which validation rules are meaningful for each field type.
 *
 * The map is the single answer to that question. Before it existed, each editing
 * surface kept its own list of type names, which cannot see a type it was not
 * written to know about — so a plugin-contributed type got no rules at all while
 * every list looked correct.
 */
import { describe, expect, it } from "vitest";

import {
  FIELD_TYPE_BINDING_KIND,
  FIELD_TYPE_VALIDATION_RULES,
  STORAGE_PRIMITIVE_AS_FIELD_TYPE,
  validationRulesForFieldType,
  type FieldValidationRule,
} from "../catalog";

const ALL_RULES: readonly FieldValidationRule[] = [
  "required",
  "pattern",
  "message",
  "minLength",
  "maxLength",
  "min",
  "max",
  "minRows",
  "maxRows",
];

describe("FIELD_TYPE_VALIDATION_RULES", () => {
  it("covers every field type the binding map covers", () => {
    // Both maps are keyed by `FieldType`, so they must agree on their key set.
    // Asserting membership rather than a count: a map that dropped one type and
    // gained another matches any total compared against it.
    expect(Object.keys(FIELD_TYPE_VALIDATION_RULES).sort()).toEqual(
      Object.keys(FIELD_TYPE_BINDING_KIND).sort()
    );
  });

  it("names only rules that exist in the vocabulary", () => {
    const entries = Object.entries(FIELD_TYPE_VALIDATION_RULES);
    expect(entries.length).toBeGreaterThan(0);

    for (const [type, rules] of entries) {
      expect(rules.length, `${type} declares no rules`).toBeGreaterThan(0);
      for (const rule of rules) {
        expect(ALL_RULES, `${type} names an unknown rule`).toContain(rule);
      }
    }
  });

  it("declares no rule twice for one type", () => {
    for (const [type, rules] of Object.entries(FIELD_TYPE_VALIDATION_RULES)) {
      expect(new Set(rules).size, `${type} repeats a rule`).toBe(rules.length);
    }
  });

  it("offers requiredness for every type", () => {
    for (const [type, rules] of Object.entries(FIELD_TYPE_VALIDATION_RULES)) {
      expect(rules, `${type} omits required`).toContain("required");
    }
  });

  it("keeps length rules off types that have no length", () => {
    // The separating property. A map that simply listed every rule everywhere
    // would satisfy the coverage assertions above and would be useless.
    expect(FIELD_TYPE_VALIDATION_RULES.checkbox).not.toContain("minLength");
    expect(FIELD_TYPE_VALIDATION_RULES.number).not.toContain("minLength");
    expect(FIELD_TYPE_VALIDATION_RULES.text).not.toContain("min");
    expect(FIELD_TYPE_VALIDATION_RULES.checkbox).not.toContain("pattern");
  });
});

describe("validationRulesForFieldType", () => {
  it("answers for a built-in type", () => {
    expect(validationRulesForFieldType("text")).toEqual(
      FIELD_TYPE_VALIDATION_RULES.text
    );
  });

  it("gives a plugin type the rules of the type its primitive behaves as", () => {
    // The reason the map is keyed by built-in type rather than copied per
    // plugin: a plugin type shipped after this code was written is covered
    // without anything here being edited.
    for (const [primitive, builtIn] of Object.entries(
      STORAGE_PRIMITIVE_AS_FIELD_TYPE
    )) {
      expect(
        validationRulesForFieldType(
          "acme-custom-field",
          primitive as keyof typeof STORAGE_PRIMITIVE_AS_FIELD_TYPE
        ),
        `primitive ${primitive}`
      ).toEqual(FIELD_TYPE_VALIDATION_RULES[builtIn]);
    }
  });

  it("gives a text-primitive plugin type real text rules, not a stub", () => {
    // Names the outcome rather than an equality, because the equality above
    // would also hold if every primitive mapped to an empty list.
    const rules = validationRulesForFieldType("acme-colour", "text");
    expect(rules).toContain("minLength");
    expect(rules).toContain("pattern");
  });

  it("falls back to what is true of every field for an undeclared type", () => {
    const rules = validationRulesForFieldType("acme-mystery");
    expect(rules).toEqual(["required", "message"]);
  });

  it("prefers the built-in entry over a primitive when both could apply", () => {
    // A plugin may not shadow a built-in type's rules by declaring a primitive.
    expect(validationRulesForFieldType("number", "text")).toEqual(
      FIELD_TYPE_VALIDATION_RULES.number
    );
  });
});

describe("validationRulesForFieldType — surface-only types", () => {
  // These are not in the canonical `FieldType` union — a collection cannot
  // declare them — so the rules table is not keyed by them. They were falling
  // through to the two rules true of any field, which left a form's URL field
  // with no pattern control: the one rule a URL field most obviously wants.
  it("gives url the rules of the text it stores as", () => {
    const rules = validationRulesForFieldType("url");
    expect(rules).toContain("pattern");
    expect(rules).toContain("minLength");
    expect(rules).toContain("maxLength");
  });

  it("gives phone the same", () => {
    expect(validationRulesForFieldType("phone")).toContain("pattern");
  });

  it("gives time and hidden the same, since they store as text too", () => {
    expect(validationRulesForFieldType("time")).toContain("pattern");
    expect(validationRulesForFieldType("hidden")).toContain("pattern");
  });

  it("MUST NOT give file text rules — its storage is the surface's own blob", () => {
    // The control for the four above: a map that answered for everything would
    // hand a file upload a minimum character count.
    const rules = validationRulesForFieldType("file");
    expect(rules).not.toContain("pattern");
    expect(rules).not.toContain("minLength");
    expect(rules).toEqual(["required", "message"]);
  });

  it("still refuses to guess for a type nothing declares", () => {
    expect(validationRulesForFieldType("totally-unknown")).toEqual([
      "required",
      "message",
    ]);
  });

  it("does not let a surface type override a canonical one", () => {
    // `text` is in the union, so it must be answered from the table rather
    // than from the surface map, whatever that map happens to say.
    expect(validationRulesForFieldType("text")).toContain("minLength");
  });
});
