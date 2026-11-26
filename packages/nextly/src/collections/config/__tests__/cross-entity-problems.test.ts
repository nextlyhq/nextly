/**
 * The configuration's rules across entities, each problem at the place of the entity that breaks
 * it, beside any problem of that entity's own.
 */
import { describe, expect, it } from "vitest";

import { crossEntityProblems } from "../cross-entity-problems";

describe("two Singles at one address, one of them with a slug that is not a string", () => {
  // The slug is that Single's own problem; the address it shares is reported as well.
  it("is reported at the second Single's address, naming it by its place", () => {
    const problems = crossEntityProblems({
      singles: [
        { slug: "home", fields: [], publicAddress: "/" },
        { slug: 7, fields: [], publicAddress: "/" },
      ],
    });

    expect(problems).toEqual([
      expect.objectContaining({
        path: "singles[1].publicAddress",
        code: "PUBLIC_ADDRESS_TAKEN",
        message: expect.stringContaining('"singles[1]"'),
      }),
    ]);
  });
});

describe("two cycles among field groups that share no group", () => {
  // Each is its own problem, reported beside the other.
  it("are both reported, each at its first group", () => {
    const group = (slug: string, inner: string) => ({
      slug,
      fields: [{ name: inner, type: "component", component: inner }],
    });

    const problems = crossEntityProblems({
      fieldGroups: [
        group("a", "b"),
        group("b", "a"),
        group("c", "d"),
        group("d", "c"),
      ],
    });

    expect(problems.map(problem => `${problem.code} ${problem.path}`)).toEqual([
      "FIELD_GROUP_CYCLE fieldGroups[0].fields",
      "FIELD_GROUP_CYCLE fieldGroups[2].fields",
    ]);
  });
});

describe("a cycle through the earlier of two field groups with one slug", () => {
  // Each definition's placements count: the cycle is reported beside the duplicate slug, not
  // once the duplicate is renamed.
  it("is reported beside the duplicate", () => {
    const group = (slug: string, inner?: string) => ({
      slug,
      fields: inner
        ? [{ name: inner, type: "component", component: inner }]
        : [{ name: "title", type: "text" }],
    });

    const codes = crossEntityProblems({
      fieldGroups: [group("a", "b"), group("b", "a"), group("a")],
    }).map(problem => problem.code);

    expect(codes).toContain("SLUG_DUPLICATE");
    expect(codes).toContain("FIELD_GROUP_CYCLE");
  });
});
