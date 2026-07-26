import { describe, expect, it } from "vitest";

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
});
