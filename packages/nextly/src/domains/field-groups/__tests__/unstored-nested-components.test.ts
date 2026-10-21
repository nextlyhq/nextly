/**
 * Which values for a component placed directly in a component the write refuses.
 *
 * Nothing stores such a value, and the admin never draws the field, so no form seeds it: a value
 * that holds anything was given by someone and would be lost, and is refused. Only an empty value
 * passes: nothing, an empty list, or an object with no authored key.
 */
import { describe, expect, it } from "vitest";

import type { FieldConfig } from "../../../collections/fields/types";
import { writeFieldGroupType } from "../storage/field-group-type-key";
import { unstoredNestedComponentIssues } from "../unstored-nested-components";

const cardFields = [
  { name: "title", type: "text" },
  { name: "badge", type: "component", component: "badge" },
  { name: "slot", type: "component", components: ["badge"] },
  // A layout container keeps its children on the same object, so one placed in it is direct too.
  {
    type: "row",
    fields: [{ name: "seal", type: "component", component: "badge" }],
  },
  {
    name: "computed",
    type: "component",
    component: "badge",
    virtual: true,
  },
] as unknown as FieldConfig[];

/** The one refusal expected, at `path`. */
const refusedAt = (path: string) => [
  expect.objectContaining({ path, code: "NOT_STORED" }),
];

describe("a value for a component placed directly in a component", () => {
  it("passes when empty", () => {
    for (const badge of [null, undefined, {}, []]) {
      expect(unstoredNestedComponentIssues({ badge }, cardFields)).toEqual([]);
    }
  });

  it("is refused when it holds anything, an empty string and false included", () => {
    // An id included: no instance of such a field is ever stored, so an id names nothing the write
    // could keep, and was sent by someone.
    for (const badge of [
      { label: "" },
      { flag: false },
      { id: "an-instance-id" },
      [{}],
      "Just a heading",
    ]) {
      expect(unstoredNestedComponentIssues({ badge }, cardFields)).toEqual(
        refusedAt("badge")
      );
    }
  });

  it("is refused for a zone row that only names its component", () => {
    const row: Record<string, unknown> = {};
    writeFieldGroupType(row, "badge");
    expect(unstoredNestedComponentIssues({ slot: row }, cardFields)).toEqual(
      refusedAt("slot")
    );
  });

  it("is refused, without walking it, when it refers back to itself", () => {
    const badge: Record<string, unknown> = { label: "" };
    badge.self = badge;
    expect(unstoredNestedComponentIssues({ badge }, cardFields)).toEqual(
      refusedAt("badge")
    );
  });

  it("is found inside a layout container, and passed over when virtual", () => {
    expect(
      unstoredNestedComponentIssues(
        { seal: { label: "S" }, computed: { label: "C" }, title: "T" },
        cardFields
      )
    ).toEqual(refusedAt("seal"));
  });
});
