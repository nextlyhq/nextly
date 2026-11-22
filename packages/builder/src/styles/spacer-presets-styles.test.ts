/**
 * A Spacer's Height presets are styled, not merely marked: in the builder's
 * own stylesheet, their row wraps, as the spacing popover's chips do, so a
 * long default name ("Section padding (top and bottom)") stays in the panel.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { chromeStylesheetSource } from "./chrome-stylesheet";

const CHROME = chromeStylesheetSource(url =>
  readFileSync(fileURLToPath(url), "utf8")
);

/** The body of the rule whose selector list names `selector`. */
function ruleFor(selector: string): string | undefined {
  for (const match of CHROME.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (match[1] ?? "").split(",").map(each => each.trim());
    if (selectors.includes(selector)) return match[2];
  }
  return undefined;
}

describe("a Spacer's Height presets", () => {
  it("wrap their row in the panel's width", () => {
    expect(ruleFor(".nx-spacer-presets .nx-segment")).toMatch(
      /flex-wrap:\s*wrap/
    );
  });

  it("cut a long name short with an ellipsis", () => {
    expect(ruleFor(".nx-spacer-presets .nx-segment__option")).toMatch(
      /text-overflow:\s*ellipsis/
    );
  });
});
