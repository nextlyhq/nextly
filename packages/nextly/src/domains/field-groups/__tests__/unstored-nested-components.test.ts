/**
 * The walk that decides whether a directly nested component's value carries anything ends on any
 * input, including a value that refers back to itself, which a Direct API caller or a hook can
 * hand it. Such a value is refused like any other that carries something, rather than walked until
 * the stack runs out.
 */
import { describe, expect, it } from "vitest";

import type { FieldConfig } from "../../../collections/fields/types";
import { unstoredNestedComponentIssues } from "../unstored-nested-components";

const note = { name: "note", type: "text" };
// `extra.back` declares the badge's own fields, so a value that points back to the badge is walked
// as a badge again: the walk descends for as long as the value lets it.
const back: { name: string; type: string; fields: unknown[] } = {
  name: "back",
  type: "group",
  fields: [],
};
const badgeFields = [
  { name: "label", type: "text" },
  { name: "extra", type: "group", fields: [back] },
  { name: "first", type: "group", fields: [note] },
  { name: "second", type: "group", fields: [note] },
] as unknown as FieldConfig[];
back.fields = badgeFields;
const cardFields = [
  { name: "badge", type: "component", component: "badge" },
] as unknown as FieldConfig[];
const resolve = (slug: string) => (slug === "badge" ? badgeFields : undefined);

describe("a value for a component placed directly in a component", () => {
  it("is refused, not walked forever, when it refers back to itself", () => {
    const badge: Record<string, unknown> = { label: "" };
    badge.extra = { back: badge };

    expect(
      unstoredNestedComponentIssues({ badge }, cardFields, resolve)
    ).toEqual([expect.objectContaining({ path: "badge", code: "NOT_STORED" })]);
  });

  // Only a value met again INSIDE itself is a cycle; one object reused side by side is not.
  it("passes a seeded object shared by two of its fields", () => {
    const empty = {};
    expect(
      unstoredNestedComponentIssues(
        { badge: { label: "", first: empty, second: empty } },
        cardFields,
        resolve
      )
    ).toEqual([]);
  });

  // No form seeds a key its component does not declare, so one with any value was given by
  // someone, `false` and "" included.
  it("is refused when it carries a key the component does not declare", () => {
    for (const stray of [false, ""]) {
      expect(
        unstoredNestedComponentIssues(
          { badge: { label: "", stray } },
          cardFields,
          resolve
        )
      ).toEqual([
        expect.objectContaining({ path: "badge", code: "NOT_STORED" }),
      ]);
    }
  });

  // The field's own declared default is what a form seeds for it, whatever its parts would say.
  it("passes the component field's own declared default, and refuses a change to it", () => {
    const preset = [
      {
        name: "badge",
        type: "component",
        component: "badge",
        defaultValue: { label: "Preset" },
      },
    ] as unknown as FieldConfig[];

    expect(
      unstoredNestedComponentIssues(
        { badge: { label: "Preset" } },
        preset,
        resolve
      )
    ).toEqual([]);
    expect(
      unstoredNestedComponentIssues(
        { badge: { label: "Other" } },
        preset,
        resolve
      )
    ).toEqual([expect.objectContaining({ path: "badge", code: "NOT_STORED" })]);
  });

  it("still passes one that holds only what a form seeds", () => {
    expect(
      unstoredNestedComponentIssues(
        { badge: { label: "" } },
        cardFields,
        resolve
      )
    ).toEqual([]);
  });
});
