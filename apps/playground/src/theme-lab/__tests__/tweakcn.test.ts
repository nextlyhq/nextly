import { describe, expect, it } from "vitest";

import { describePreset } from "../../../scripts/tweakcn-description.mjs";
import { themeToCss } from "../generate-css";
import { TWEAKCN_THEMES } from "../themes/tweakcn.generated";

// The count is pinned to what scripts/import-tweakcn.mjs currently produces
// rather than a fixed target: tweakcn is a living third-party registry that
// has grown since this importer was written, and truncating to an arbitrary
// older number would silently drop real presets. Re-running the importer
// after tweakcn publishes more requires bumping this number too.
describe("tweakcn presets", () => {
  it("imports every published preset", () => {
    expect(TWEAKCN_THEMES).toHaveLength(42);
  });

  it("marks every preset as third-party", () => {
    for (const theme of TWEAKCN_THEMES) {
      expect(theme.group).toBe("tweakcn");
    }
  });

  it("prefixes ids so they cannot collide with nextly themes", () => {
    for (const theme of TWEAKCN_THEMES) {
      expect(theme.id).toMatch(/^tweakcn-/);
    }
  });

  it("has unique ids", () => {
    const ids = TWEAKCN_THEMES.map(theme => theme.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(TWEAKCN_THEMES)("$label generates complete css", theme => {
    expect(() => themeToCss(theme)).not.toThrow();
  });

  // The descriptions are derived, not authored, so the thing worth asserting
  // is that the checked-in file still agrees with the deriver: a hand edit to
  // the generated file, or a change to the derivation that was never followed
  // by a re-import, both show up here as a preset describing itself wrongly.
  it.each(TWEAKCN_THEMES)("$label describes its own values", theme => {
    expect(theme.description).toBe(describePreset(theme.radius, theme.light));
  });
});
