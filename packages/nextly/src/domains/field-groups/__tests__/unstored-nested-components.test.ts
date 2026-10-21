/**
 * The walk that decides whether a directly nested component's value carries anything ends on any
 * input, including a value that refers back to itself, which a Direct API caller or a hook can
 * hand it. Such a value is refused like any other that carries something, rather than walked until
 * the stack runs out.
 */
import { describe, expect, it } from "vitest";

import type { FieldConfig } from "../../../collections/fields/types";
import { unstoredNestedComponentIssues } from "../unstored-nested-components";

const badgeFields = [{ name: "label", type: "text" }] as FieldConfig[];
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
