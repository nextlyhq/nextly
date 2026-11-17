import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { chromeStylesheetSource } from "./chrome-stylesheet";

/**
 * Where the "+" between sections stays shown without a pointer near it,
 * asserted against the sheet that shows it.
 *
 * jsdom applies no stylesheet, and the browser the end-to-end suite drives
 * cannot tell the two media queries apart: its touch emulation makes the
 * PRIMARY pointer coarse, which both match. The plausible broken sheet asks
 * `(pointer: coarse)`, which a touchscreen laptop with a mouse as its primary
 * pointer does not match, so a tap there lands on a "+" that is hidden and
 * takes no presses. So the query is held to the sheet.
 *
 * @module page-inserters-styles.test
 */
const CHROME = chromeStylesheetSource(url =>
  readFileSync(fileURLToPath(url), "utf8")
);

/** The body of the media block that holds a rule for `selector`. */
function mediaHolding(selector: string): { query: string; body: string } {
  const at = CHROME.indexOf(`  ${selector} {`);
  if (at === -1) throw new Error(`no nested rule for selector: ${selector}`);
  const open = CHROME.lastIndexOf("@media", at);
  const query = CHROME.slice(open, CHROME.indexOf("{", open)).trim();
  const body = CHROME.slice(at, CHROME.indexOf("}", at));
  return { query, body };
}

describe("the + between sections on a touch screen", () => {
  it("is shown and pressable wherever ANY pointer is coarse", () => {
    const { query, body } = mediaHolding(".nx-page-inserters__add");
    expect(query).toBe("@media (any-pointer: coarse)");
    expect(body).toContain("pointer-events: auto;");
    expect(body).toContain("opacity: 1;");
  });
});

/** Every rule body in the sheet one of whose selectors names `className`. */
function rulesNaming(className: string): string[] {
  const sheet = CHROME.replace(/\/\*[\s\S]*?\*\//g, "");
  const bodies: string[] = [];
  for (const match of sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if ((match[1] ?? "").includes(className)) bodies.push(match[2] ?? "");
  }
  return bodies;
}

/** A literal colour: a hex, an rgb or hsl function, or a named colour. */
const LITERAL_COLOUR =
  /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(|:\s*(?:white|black|blue|grey|gray|red)\b/i;

describe("the gap + and the empty container's overlay take the editor's colours", () => {
  it.each([
    "nx-page-inserters__add",
    "nx-page-inserters__line",
    "nx-empty-container-appenders__area",
  ])("states no literal colour in .%s", className => {
    const bodies = rulesNaming(className);
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) expect(body).not.toMatch(LITERAL_COLOUR);
  });

  it("draws the empty container's overlay in the selection colour, outlined and tinted", () => {
    const shown = rulesNaming(
      ".nx-empty-container-appenders__area[data-pointed]"
    ).join("");
    expect(shown).toMatch(/outline: 1px solid var\(--nx-builder-select\)/);
    expect(shown).toMatch(
      /background: color-mix\(in srgb, var\(--nx-builder-select\) \d+%, transparent\)/
    );
  });

  it("uses the system's Highlight for both under forced colours", () => {
    const forced = CHROME.split("@media (forced-colors: active)").slice(1);
    const add = forced.find(block =>
      block.slice(0, block.indexOf("}")).includes(".nx-page-inserters__add")
    );
    expect(add).toMatch(/background: Highlight;/);
    const area = forced.find(block =>
      block
        .slice(0, block.indexOf("}"))
        .includes(".nx-empty-container-appenders__area[data-pointed]")
    );
    expect(area).toMatch(/outline-color: Highlight;/);
  });
});
