/**
 * Whether content reaches a localized field group, at any depth, and how often
 * each group's definition is read to answer it.
 */
import { describe, expect, it } from "vitest";

import {
  reachesLocalizedFieldGroup,
  reachesLocalizedFieldGroupIn,
  type FieldGroupDefinition,
} from "./per-language-fields";

const group = (component: string) => ({
  type: "component",
  name: component,
  component,
});

/** Definitions by slug: `outer` holds `inner`, which is localized. */
const DEFINITIONS = new Map<string, FieldGroupDefinition>([
  ["outer", { fields: [group("inner")] }],
  ["inner", { localized: true, fields: [{ type: "text", name: "note" }] }],
  ["plain", { fields: [{ type: "text", name: "note" }] }],
  ["itself", { fields: [group("itself")] }],
]);

const known = (slug: string) => DEFINITIONS.get(slug) ?? null;

describe("reachesLocalizedFieldGroupIn", () => {
  it("finds a localized group inside a group that is not", () => {
    expect(reachesLocalizedFieldGroupIn([group("outer")], known)).toBe(true);
  });

  it("answers no for groups that are not localized at any depth", () => {
    expect(reachesLocalizedFieldGroupIn([group("plain")], known)).toBe(false);
  });

  it("ends the walk at a group that holds itself", () => {
    expect(reachesLocalizedFieldGroupIn([group("itself")], known)).toBe(false);
  });

  it("passes over a group that is not defined", () => {
    expect(reachesLocalizedFieldGroupIn([group("missing")], known)).toBe(false);
  });

  it("names the first group it has not read yet", () => {
    expect(
      reachesLocalizedFieldGroupIn([group("outer")], () => undefined)
    ).toEqual({ unread: "outer" });
  });
});

describe("reachesLocalizedFieldGroup", () => {
  it("reads each group it reaches once", async () => {
    const reads: string[] = [];
    const reaches = await reachesLocalizedFieldGroup(
      [group("plain"), group("plain"), group("outer")],
      slug => {
        reads.push(slug);
        return Promise.resolve(known(slug));
      }
    );
    expect(reaches).toBe(true);
    expect(reads).toEqual(["plain", "outer", "inner"]);
  });
});
