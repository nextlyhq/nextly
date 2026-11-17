/**
 * The checks a simple form's answers meet: the rules a browser applies to
 * each control, read from the field description alone, so a post that
 * skipped the browser is held to what the form showed and one the browser
 * passed is never refused here.
 */
import type { FormFieldDescription } from "@nextlyhq/plugin-sdk/blocks";
import { describe, expect, it } from "vitest";

import { checkAnswers, describedAnswers } from "./answers";

const field = (
  kind: FormFieldDescription["kind"],
  extra: Partial<FormFieldDescription> = {}
): FormFieldDescription => ({ name: "a", label: "A", kind, ...extra });

/** Whether one answer to one field is accepted. */
const accepts = (spec: FormFieldDescription, ...values: string[]): boolean =>
  checkAnswers([spec], new Map([["a", values]])).ok;

describe("each control's rule", () => {
  it("refuses an empty required answer, and takes an empty optional one", () => {
    expect(accepts(field("text", { required: true }))).toBe(false);
    expect(accepts(field("text", { required: true }), "")).toBe(false);
    expect(accepts(field("text", { required: true }), "x")).toBe(true);
    expect(accepts(field("text"))).toBe(true);
    expect(accepts(field("email"), "")).toBe(true);
  });

  it("reads an email as the HTML standard does", () => {
    for (const good of ["a@b", "first.last+tag@example.co.uk"]) {
      expect(accepts(field("email"), good), good).toBe(true);
    }
    for (const bad of ["a", "a@", "@b", "a b@c.d", "a@-b.c"]) {
      expect(accepts(field("email"), bad), bad).toBe(false);
    }
  });

  it("takes only an absolute web address for a link", () => {
    expect(accepts(field("url"), "https://example.com/x")).toBe(true);
    expect(accepts(field("url"), "example.com")).toBe(false);
  });

  it("takes a number within the field's bounds", () => {
    const spec = field("number", { min: 1, max: 10 });
    for (const good of ["1", "10", "2.5", "1e1"]) {
      expect(accepts(spec, good), good).toBe(true);
    }
    for (const bad of ["0", "11", "abc", "1,5", "Infinity", "0x5"]) {
      expect(accepts(spec, bad), bad).toBe(false);
    }
  });

  it("takes a real date and a time", () => {
    expect(accepts(field("date"), "2026-02-28")).toBe(true);
    expect(accepts(field("date"), "2026-02-30")).toBe(false);
    expect(accepts(field("date"), "28/02/2026")).toBe(false);
    expect(accepts(field("time"), "09:30")).toBe(true);
    expect(accepts(field("time"), "25:00")).toBe(false);
  });

  it("takes only a listed choice", () => {
    const options = [
      { value: "red", label: "Red" },
      { value: "blue", label: "Blue" },
    ];
    expect(accepts(field("select", { options }), "red")).toBe(true);
    expect(accepts(field("select", { options }), "green")).toBe(false);
    expect(accepts(field("radio", { options }), "blue")).toBe(true);
    // A checkbox group sends each ticked choice under one name.
    expect(accepts(field("checkbox", { options }), "red", "blue")).toBe(true);
    expect(accepts(field("checkbox", { options }), "red", "pink")).toBe(false);
  });

  it("takes one answer for a field that sends one", () => {
    expect(accepts(field("text"), "x", "y")).toBe(false);
    expect(
      accepts(
        field("radio", { options: [{ value: "x", label: "X" }] }),
        "x",
        "x"
      )
    ).toBe(false);
  });
});

describe("the answers judged", () => {
  it("keep the form's order and drop every name it does not have", () => {
    const result = checkAnswers(
      [field("text", { name: "b" }), field("text", { name: "a" })],
      new Map([
        ["a", ["1"]],
        ["extra", ["dropped"]],
        ["b", ["2"]],
      ])
    );
    expect(result).toEqual({
      ok: true,
      answers: [
        { name: "b", values: ["2"] },
        { name: "a", values: ["1"] },
      ],
    });
  });

  it("name every refused field", () => {
    const result = checkAnswers(
      [
        field("email", { name: "email", required: true }),
        field("number", { name: "age" }),
        field("text", { name: "fine" }),
      ],
      new Map([
        ["age", ["old"]],
        ["fine", ["x"]],
      ])
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues.map(issue => issue.field)).toEqual([
      "email",
      "age",
    ]);
  });

  it("trim a provider's post to the fields it describes", () => {
    expect([
      ...describedAnswers(
        [field("text", { name: "a" })],
        new Map([
          ["a", ["1"]],
          ["b", ["2"]],
        ])
      ),
    ]).toEqual([["a", ["1"]]]);
  });
});
