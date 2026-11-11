/**
 * How a Count card's settings follow one another in its drawer: set to Users there is no Count
 * and no Filter; set to a collection without a lifecycle there is no Count; and a status split is
 * offered only beside Count: All entries of a collection with a lifecycle, so every line under the
 * number describes what the number counts.
 */
import type { PublishedContentSource } from "nextly/config";
import { describe, expect, it } from "vitest";

import { countSettingRule, SPLIT_NEEDS_ALL } from "./count-settings";

const SOURCES = [
  { collection: "posts", label: "Posts", lifecycle: true, fields: [] },
  { collection: "logs", label: "Logs", lifecycle: false, fields: [] },
] as unknown as readonly PublishedContentSource[];

/** What the split is, beside the card's other settings. */
const NO_SPLIT = {
  disabled: ["split"],
  fallback: "change",
  hint: SPLIT_NEEDS_ALL,
};

describe("a Count card's settings, as the drawer holds them", () => {
  it("offers Count and Filter for a collection with a lifecycle", () => {
    const values = { collection: "posts", count: "all" };
    expect(countSettingRule("count", values, SOURCES)).toBeUndefined();
    expect(countSettingRule("filter", values, SOURCES)).toBeUndefined();
  });

  it("hides Count for a collection without a lifecycle, keeping its Filter", () => {
    const values = { collection: "logs" };
    expect(countSettingRule("count", values, SOURCES)).toEqual({
      hidden: true,
    });
    expect(countSettingRule("filter", values, SOURCES)).toBeUndefined();
  });

  it("hides Count and Filter for Users, which has no entries to choose among", () => {
    const values = { collection: "users", count: "draft" };
    expect(countSettingRule("count", values, SOURCES)).toEqual({
      hidden: true,
    });
    expect(countSettingRule("filter", values, SOURCES)).toEqual({
      hidden: true,
    });
  });

  it("offers the status split with every entry of a collection with a lifecycle alone", () => {
    expect(
      countSettingRule("show", { collection: "posts", count: "all" }, SOURCES)
    ).toBeUndefined();
    // A Count never chosen counts every entry.
    expect(
      countSettingRule("show", { collection: "posts" }, SOURCES)
    ).toBeUndefined();
  });

  it.each([
    ["Published", { collection: "posts", count: "published" }],
    ["Drafts", { collection: "posts", count: "draft" }],
    ["a collection without a lifecycle", { collection: "logs", count: "all" }],
    ["Users", { collection: "users" }],
  ])("rules the split out beside %s, giving way to the change", (_, values) => {
    expect(countSettingRule("show", values, SOURCES)).toEqual(NO_SPLIT);
  });

  it("says nothing of a setting it has no rule for", () => {
    expect(
      countSettingRule("title", { collection: "users" }, SOURCES)
    ).toBeUndefined();
  });
});
