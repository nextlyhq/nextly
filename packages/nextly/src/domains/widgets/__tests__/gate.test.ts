/**
 * The widget gate's three forms, asked through both of its answerers: the
 * server's map of resolved verdicts and the browser's permission predicate.
 * Both call the one rule, so one truth table holds them to the same answers.
 */
import { describe, expect, it } from "vitest";

import {
  holdsWidgetPermission,
  requiredPermissionGroups,
  requiredPermissionSlugs,
  widgetGateHolds,
} from "../gate";

/** The Team card's gate: a reader who may read people AND may add or change them. */
const TEAM = {
  allOf: ["read-users", { anyOf: ["create-users", "update-users"] }],
};

/** Each reader's grants, and whether the Team gate admits them. */
const TABLE: Array<[string, string[], boolean]> = [
  ["read only", ["read-users"], false],
  ["read and create", ["read-users", "create-users"], true],
  ["read and update", ["read-users", "update-users"], true],
  ["create and update without read", ["create-users", "update-users"], false],
  ["nothing", [], false],
];

describe("an allOf gate", () => {
  it.each(TABLE)(
    "answers %s the same on the server and in the browser",
    (_case, grants, admitted) => {
      const held = new Set(grants);
      // The browser: the session's permission predicate.
      expect(widgetGateHolds(TEAM, slug => held.has(slug))).toBe(admitted);
      // The server: verdicts resolved for every slug the gate names.
      const verdicts = new Map(
        (requiredPermissionSlugs(TEAM) ?? []).map(slug => [
          slug,
          held.has(slug),
        ])
      );
      expect(holdsWidgetPermission(TEAM, verdicts)).toBe(admitted);
    }
  );

  it("names every slug once, so the server resolves a verdict for each", () => {
    expect(requiredPermissionSlugs(TEAM)).toEqual([
      "read-users",
      "create-users",
      "update-users",
    ]);
  });
});

describe("an anyOf gate", () => {
  /** The Upcoming releases card's gate: any one of three permissions opens it. */
  const RELEASES = {
    anyOf: [
      "read-content-releases",
      "create-content-releases",
      "publish-content-releases",
    ],
  };

  it.each(RELEASES.anyOf)(
    "opens the card for a holder of %s alone, on the server and in the browser",
    slug => {
      expect(widgetGateHolds(RELEASES, held => held === slug)).toBe(true);
      const verdicts = new Map(
        (requiredPermissionSlugs(RELEASES) ?? []).map(each => [
          each,
          each === slug,
        ])
      );
      expect(holdsWidgetPermission(RELEASES, verdicts)).toBe(true);
    }
  );

  it("opens it for no one holding none of them", () => {
    expect(widgetGateHolds(RELEASES, held => held === "read-posts")).toBe(
      false
    );
    expect(widgetGateHolds(RELEASES, () => false)).toBe(false);
  });

  it.each([
    ["an empty anyOf", { anyOf: [] }],
    ["an entry that is not a slug", { anyOf: ["read-posts", 7] }],
    ["a key beside anyOf", { anyOf: ["read-posts"], allOf: ["x"] }],
  ])("refuses %s, for everyone", (_case, gate) => {
    expect(requiredPermissionGroups(gate)).toBeUndefined();
    expect(widgetGateHolds(gate, () => true)).toBe(false);
  });
});

describe("a slug, and a list", () => {
  it("keeps a slug meaning one permission", () => {
    const held =
      (...slugs: string[]) =>
      (slug: string) =>
        slugs.includes(slug);
    expect(widgetGateHolds("read-users", held("read-users"))).toBe(true);
    expect(widgetGateHolds("read-users", held())).toBe(false);
  });

  it("refuses a bare list, for everyone, as no gate a declaration may write", () => {
    // A list would read as "any" to one author and "all" to the next, so it is
    // refused rather than given either meaning; `{ anyOf }` says the one.
    expect(requiredPermissionGroups(["a", "b"])).toBeUndefined();
    expect(widgetGateHolds(["a", "b"], () => true)).toBe(false);
    // The same list inside allOf is refused too: an entry is a slug or `{ anyOf }`.
    expect(widgetGateHolds({ allOf: ["a", ["b"]] }, () => true)).toBe(false);
  });

  it("admits everyone when no gate is declared", () => {
    expect(widgetGateHolds(undefined, () => false)).toBe(true);
  });
});
