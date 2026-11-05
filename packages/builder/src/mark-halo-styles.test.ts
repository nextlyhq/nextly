import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Which marks draw no halo band, asserted against the sheet that draws them.
 *
 * jsdom applies no stylesheet, so a test of the marks' attributes passes
 * whatever the sheet says. The plausible broken sheet is one whose rule is
 * outweighed: a secondary selection's own halo rule is more specific than a
 * plain `[data-clipped]` one, so a clipped or shaped SECONDARY mark would
 * still draw the band. Each case is held to a rule at least as specific.
 *
 * @module mark-halo-styles.test
 */
const CHROME = readFileSync(
  fileURLToPath(new URL("./styles/builder-chrome.css", import.meta.url)),
  "utf8"
);

/** The declarations of the rule whose selector list includes `selector`. */
function ruleWith(selector: string): string {
  const at = CHROME.indexOf(selector);
  if (at === -1) throw new Error(`no rule for selector: ${selector}`);
  const open = CHROME.indexOf("{", at);
  return CHROME.slice(open + 1, CHROME.indexOf("}", open));
}

describe("a mark with no halo band", () => {
  it.each(["data-clipped", "data-shaped"])(
    "draws none when %s, a secondary or hovered mark's included",
    flag => {
      expect(ruleWith(`.nx-canvas-mark[${flag}]`)).toContain(
        "box-shadow: none;"
      );
      expect(
        ruleWith(
          `.nx-canvas-mark[data-mark="selected"][data-secondary][${flag}]`
        )
      ).toContain("box-shadow: none;");
      // A hovered mark's own halo rule is as specific as the plain one and
      // later in the sheet, so a hovered clipped or shaped block needs its own.
      expect(
        ruleWith(`.nx-canvas-mark[data-mark="hovered"][${flag}]`)
      ).toContain("box-shadow: none;");
    }
  );
});
