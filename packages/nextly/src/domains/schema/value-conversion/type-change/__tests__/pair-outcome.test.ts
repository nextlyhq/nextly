/**
 * The mark a type picker shows for a change from a saved field's type to another, judged by the
 * rules over a value of each kind the field's type holds: keeps every value, converts some, or may
 * lose some; none where the pair is blocked whatever its values hold. On every database.
 */
import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "../../../../../schemas/dynamic-collections";
import type { SupportedDialect } from "../../../services/field-column-descriptor";
import { fieldTypeOnDialect, type FieldTypeOnDialect } from "../field-type";
import { pairOutcome } from "../pair-outcome";

const DIALECTS: SupportedDialect[] = ["postgresql", "mysql", "sqlite"];

function typeOf(
  dialect: SupportedDialect,
  type: string,
  extra: Partial<FieldDefinition> = {}
): FieldTypeOnDialect {
  return fieldTypeOnDialect(
    { name: "f", type, ...extra } as FieldDefinition,
    dialect,
    "collection"
  );
}

const choices = {
  options: [
    { label: "Draft", value: "draft" },
    { label: "Done", value: "done" },
  ],
} as Partial<FieldDefinition>;

const several = { hasMany: true } as Partial<FieldDefinition>;

describe.each(DIALECTS)("the mark of a type change (%s)", dialect => {
  const outcome = (
    from: string,
    to: string,
    fromExtra: Partial<FieldDefinition> = {},
    toExtra: Partial<FieldDefinition> = {}
  ) =>
    pairOutcome(typeOf(dialect, from, fromExtra), typeOf(dialect, to, toExtra));

  it("keeps every value: text to text, and a dropdown to text", () => {
    expect(outcome("text", "text")).toBe("keeps");
    expect(outcome("select", "text", choices)).toBe("keeps");
  });

  it("converts values: a number, a checkbox or a date written as text", () => {
    expect(outcome("number", "text")).toBe("converts");
    expect(outcome("checkbox", "text")).toBe("converts");
    expect(outcome("date", "text")).toBe("converts");
  });

  it("may lose values: text to a number, a checkbox or a dropdown", () => {
    expect(outcome("text", "number")).toBe("may-lose");
    expect(outcome("text", "checkbox")).toBe("may-lose");
    expect(outcome("text", "select", {}, choices)).toBe("may-lose");
  });

  // A choice given no options yet takes them later, and the values are judged against those then:
  // nothing here says every value will be one of them.
  it("may lose values: a text becoming a choice that has no options yet", () => {
    expect(outcome("text", "select")).toBe("may-lose");
    expect(outcome("text", "radio")).toBe("may-lose");
    // A dropdown taking several choices too.
    expect(
      outcome("text", "select", {}, {
        hasMany: true,
      } as Partial<FieldDefinition>)
    ).toBe("may-lose");
  });

  // An email field holds addresses, which none of the plain text probes is: judged over one.
  it("judges an email field over an address it holds: lost as a checkbox, rewritten as rich text", () => {
    expect(outcome("email", "checkbox")).toBe("may-lose");
    expect(outcome("email", "richText")).toBe("converts");
    expect(outcome("email", "text")).toBe("keeps");
  });

  // A family with no value of its own to judge would answer "may lose" for a change to itself.
  it("keeps every value of rich text, JSON and a list changed to themselves", () => {
    expect(outcome("richText", "richText")).toBe("keeps");
    expect(outcome("json", "json")).toBe("keeps");
    expect(outcome("text", "text", several, several)).toBe("keeps");
  });

  it("judges a list by its items: each converted as a list, all but one lost as one value", () => {
    expect(outcome("number", "text", several, several)).toBe("converts");
    expect(outcome("text", "text", several)).toBe("may-lose");
  });

  // A JSON field holds a list of several, which no type of one value takes, and an object, which no
  // list does: nothing but JSON keeps or converts them all, whatever length their writing has.
  it("may lose values: JSON becoming anything but JSON", () => {
    for (const to of [
      "text",
      "textarea",
      "code",
      "email",
      "richText",
      "number",
      "checkbox",
      "date",
      "chips",
    ]) {
      expect(outcome("json", to), to).toBe("may-lose");
    }
    expect(outcome("json", "select", {}, choices)).toBe("may-lose");
    expect(outcome("json", "text", {}, several)).toBe("may-lose");
  });

  it("is blocked whatever the values hold: a group, a relationship to text, or rich text to a number", () => {
    expect(outcome("richText", "number")).toBeNull();
    expect(outcome("group", "text", { fields: [] })).toBeNull();
    expect(outcome("relationship", "text", { relationTo: "posts" })).toBeNull();
  });
});
