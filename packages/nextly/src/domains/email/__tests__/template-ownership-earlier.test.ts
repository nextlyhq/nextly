/**
 * A version core shipped before its current one is still core's: a stored row
 * holding it was never edited, so when it is first given its owner it follows
 * core instead of being kept as the site's own.
 */
import { describe, expect, it } from "vitest";

import {
  BUILT_IN_TEMPLATES,
  DEFAULT_LAYOUT_BEFORE_BRAND,
  DEFAULT_LAYOUT_SLUG,
  EARLIER_BUILT_IN_VERSIONS,
} from "../services/templates";
import {
  buildTemplateOwnerRegistry,
  isOwnersVersion,
  versionOf,
} from "../template-ownership";

const registry = buildTemplateOwnerRegistry({
  builtIns: BUILT_IN_TEMPLATES,
  earlierBuiltIns: EARLIER_BUILT_IN_VERSIONS,
  plugins: [],
  complete: true,
}).registry;

const layout = () => {
  const entry = registry.owned.get(DEFAULT_LAYOUT_SLUG);
  if (!entry) throw new Error("no default layout");
  return entry;
};

describe("an owner's earlier versions", () => {
  it("count the current version as the owner's", () => {
    expect(isOwnersVersion(layout(), layout().version)).toBe(true);
  });

  it("count the default layout from before brand settings as core's", () => {
    expect(isOwnersVersion(layout(), DEFAULT_LAYOUT_BEFORE_BRAND)).toBe(true);
  });

  it("do not count an edit of either as the owner's", () => {
    for (const version of [layout().version, DEFAULT_LAYOUT_BEFORE_BRAND]) {
      expect(
        isOwnersVersion(layout(), {
          ...version,
          htmlContent: version.htmlContent.replace("40px", "48px"),
        })
      ).toBe(false);
    }
  });

  it("belong only to the template they were shipped as", () => {
    const welcome = registry.owned.get("welcome");
    if (!welcome) throw new Error("no welcome");
    expect(isOwnersVersion(welcome, DEFAULT_LAYOUT_BEFORE_BRAND)).toBe(false);
    expect(isOwnersVersion(welcome, versionOf(welcome.defaults))).toBe(true);
  });
});
