import { describe, expect, it } from "vitest";

import { describePreset } from "../../../scripts/tweakcn-description.mjs";
import { themeToCss } from "../generate-css";
import { TWEAKCN_THEMES } from "../themes/tweakcn.generated";

// The checked-in file carries the SHORTLIST, not the full registry: the
// importer still knows every published preset, and re-running it restores
// any of them, but what ships in the lab is the five under comparison. The
// ids are pinned individually so a wrong deletion (or an accidental
// re-import of the full set) fails by name rather than by count alone.
describe("tweakcn presets", () => {
  it("carries exactly the shortlisted presets", () => {
    expect(TWEAKCN_THEMES.map(theme => theme.id).sort()).toEqual([
      "tweakcn-claude",
      "tweakcn-modern-minimal",
      "tweakcn-twitter",
      "tweakcn-vercel",
      "tweakcn-violet-bloom",
    ]);
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
