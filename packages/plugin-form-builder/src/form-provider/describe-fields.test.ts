/**
 * Each of the forms plugin's field types, as the page builder's Form block is
 * told to draw it.
 */
import { describe, expect, it } from "vitest";

import { BUILT_IN_FORM_FIELD_TYPES, type AnyFormField } from "../types";

import { describeField, FIELD_KINDS } from "./describe-fields";

const field = (type: string, extra: object = {}): AnyFormField =>
  ({ type, name: `${type}-answer`, label: `A ${type}`, ...extra }) as never;

describe("the plugin's field types, described", () => {
  it("maps every built-in type to a plain control", () => {
    // Must-be-found: the plugin's own list, so a type it gains is asked here.
    expect(BUILT_IN_FORM_FIELD_TYPES.length).toBeGreaterThanOrEqual(13);
    for (const type of BUILT_IN_FORM_FIELD_TYPES) {
      expect(FIELD_KINDS[type], type).toBeDefined();
      expect(describeField(field(type))?.kind, type).toBe(FIELD_KINDS[type]);
    }
    expect(FIELD_KINDS).toEqual({
      text: "text",
      email: "email",
      number: "number",
      phone: "tel",
      url: "url",
      textarea: "textarea",
      select: "select",
      checkbox: "checkbox",
      radio: "radio",
      file: "file",
      date: "date",
      time: "time",
      hidden: "hidden",
      consent: "checkbox",
    });
  });

  it("carries the label, help, placeholder, required, limits and options", () => {
    expect(
      describeField(
        field("number", {
          required: true,
          helpText: "In years.",
          placeholder: "30",
          validation: { min: 18, max: 120 },
        })
      )
    ).toEqual({
      name: "number-answer",
      label: "A number",
      kind: "number",
      required: true,
      help: "In years.",
      placeholder: "30",
      min: 18,
      max: 120,
    });
    expect(
      describeField(
        field("select", {
          options: [
            { value: "s", label: "Small" },
            { value: "", label: "Dropped" },
          ],
        })
      )?.options
    ).toEqual([{ value: "s", label: "Small" }]);
    expect(describeField(field("file", { accept: "image/*" }))?.accept).toBe(
      "image/*"
    );
    expect(
      describeField(field("text", { validation: { pattern: "[A-Z]+" } }))
        ?.pattern
    ).toBeDefined();
  });

  it("states a pattern the browser reads as the server does: matching part of the answer", () => {
    // The server tests `new RegExp(pattern)` against the answer, which passes
    // when any part of it matches. A browser's `pattern` must match the whole
    // value, compiled as `^(?:pattern)$` with the `v` flag, so the stated
    // pattern must accept the same answers.
    const browserAccepts = (pattern: string, answer: string): boolean => {
      const stated = describeField(field("text", { validation: { pattern } }))
        ?.pattern;
      if (stated === undefined) return true;
      return new RegExp(`^(?:${stated})$`, "v").test(answer);
    };
    const serverAccepts = (pattern: string, answer: string): boolean =>
      new RegExp(pattern).test(answer);
    const cases: Array<[string, string]> = [
      ["@example\\.com$", "ada@example.com"],
      ["@example\\.com$", "ada@example.org"],
      ["[A-Z]+", "abcD"],
      ["[A-Z]+", "abcd"],
      ["^[0-9]{5}$", "12345"],
      ["^[0-9]{5}$", "123456"],
      ["^ab|cd$", "abzz"],
      ["^ab|cd$", "zzab"],
    ];
    for (const [pattern, answer] of cases) {
      expect([pattern, answer, browserAccepts(pattern, answer)]).toEqual([
        pattern,
        answer,
        serverAccepts(pattern, answer),
      ]);
    }
  });

  it("draws a Dropdown taking several answers as a group of checkboxes", () => {
    const described = describeField(
      field("select", {
        allowMultiple: true,
        options: [{ value: "a", label: "A" }],
      })
    );
    expect(described?.kind).toBe("checkbox");
    expect(described?.options).toEqual([{ value: "a", label: "A" }]);
  });

  it("labels a consent box with the words a visitor agrees to", () => {
    expect(
      describeField(
        field("consent", { agreementText: "I agree to the terms." })
      )?.label
    ).toBe("I agree to the terms.");
  });

  it("carries a condition as opaque data for the plugin's own script", () => {
    const conditionalLogic = {
      enabled: true,
      action: "show",
      operator: "AND",
      conditions: [{ field: "topic", comparison: "equals", value: "other" }],
    };
    expect(
      describeField(field("text", { conditionalLogic }))?.provider
    ).toEqual({ "forms-condition": JSON.stringify(conditionalLogic) });
    expect(
      describeField(
        field("text", {
          conditionalLogic: { ...conditionalLogic, enabled: false },
        })
      )
    ).not.toHaveProperty("provider");
  });

  it("leaves a conditional field's requirement to the server, which knows when it applies", () => {
    const described = describeField(
      field("text", {
        required: true,
        conditionalLogic: {
          enabled: true,
          action: "show",
          operator: "AND",
          conditions: [
            { field: "kind", comparison: "equals", value: "business" },
          ],
        },
      })
    );
    expect(described).not.toHaveProperty("required");
    // An unconditional required field is still required in the browser.
    expect(describeField(field("text", { required: true }))?.required).toBe(
      true
    );
  });

  it("describes no type another plugin added, which no plain control draws", () => {
    expect(describeField(field("signature"))).toBeUndefined();
  });
});
