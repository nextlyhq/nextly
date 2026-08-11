import { describe, expect, it } from "vitest";

import { describePreset } from "../../../scripts/tweakcn-description.mjs";
import { TWEAKCN_SHORTLIST } from "../../../scripts/tweakcn-shortlist.mjs";
import { themeToCss } from "../generate-css";
import { TWEAKCN_THEMES } from "../themes/tweakcn.generated";

// The checked-in file carries the SHORTLIST, not the full registry: the
// importer still knows every published preset, and re-running it narrows to
// the ones under comparison.
//
// The expected ids are READ from the importer's shortlist rather than
// restated here. Restating them meant the generator and the test each held
// their own copy, and the generator's copy did not exist at all -- the
// narrowing was done by hand-deleting from the generated file, so
// regenerating restored every preset and this test was the only thing that
// noticed. A test that spells out the answer independently cannot catch the
// two going out of step; it just becomes the second place to edit.
describe("tweakcn presets", () => {
  it("carries exactly the shortlisted presets", () => {
    expect(TWEAKCN_THEMES.map(theme => theme.id).sort()).toEqual(
      [...TWEAKCN_SHORTLIST].sort()
    );
  });

  it("has a shortlist that narrows something", () => {
    // Comparing a list against itself passes for any content, including
    // empty. This is the fixture check that keeps the assertion above from
    // meaning nothing if the shortlist is ever emptied or the import breaks.
    expect(TWEAKCN_SHORTLIST.length).toBeGreaterThan(1);
    expect(TWEAKCN_THEMES.length).toBe(TWEAKCN_SHORTLIST.length);
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
