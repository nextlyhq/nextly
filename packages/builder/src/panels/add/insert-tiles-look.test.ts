import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { chromeStylesheetSource } from "../../styles/chrome-stylesheet";

import { GRID_COLUMNS, PICTURE_COLUMNS } from "./insert-panel-tiles";

/**
 * How the Add panel's tiles look, asserted against the sheet that draws them.
 *
 * jsdom lays nothing out and applies no stylesheet, so whether a tile is a
 * row, where its name breaks and how a refused one reads are the sheet's
 * declarations. The plausible broken sheets are the ones these replace: a
 * column tile with its mark above the name, a name that breaks inside a word
 * (`overflow-wrap: anywhere`), and a refused tile whose name is greyed down
 * to the faint text it was.
 *
 * @module insert-tiles-look.test
 */
const SHEET = chromeStylesheetSource(url =>
  readFileSync(fileURLToPath(url), "utf8")
).replace(/\/\*[\s\S]*?\*\//g, "");

/** The body of the one rule whose whole selector is `selector`. */
function rule(selector: string): string {
  for (const match of SHEET.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const found = (match[1] ?? "").replace(/\s+/g, " ").trim();
    if (found === selector) return match[2] ?? "";
  }
  throw new Error(`no rule for ${selector}`);
}

describe("the Add panel's tiles", () => {
  it("sit two across, with pictures or without", () => {
    expect(GRID_COLUMNS).toBe(2);
    expect(PICTURE_COLUMNS).toBe(2);
  });

  it("draw a block's mark to the left of its name", () => {
    // Only a tile with a mark: a saved section's picture stays above its name.
    const tile = rule(".nx-insert-panel [cmdk-item]:has(> .nx-block-icon)");
    expect(tile).toMatch(/flex-direction:\s*row/);
    expect(tile).toMatch(/text-align:\s*start/);
  });

  it("set the mark in a soft square of the accent", () => {
    const mark = rule(".nx-insert-panel [cmdk-item] > .nx-block-icon");
    expect(mark).toMatch(/width:\s*1\.375rem/);
    expect(mark).toMatch(/height:\s*1\.375rem/);
    expect(mark).toMatch(/border-radius:/);
    expect(mark).toMatch(/background:\s*color-mix\([^;]*var\(--nx-primary\)/);
  });

  it("break a name only between its words", () => {
    const label = rule(".nx-insert-panel__label");
    expect(label).not.toMatch(/overflow-wrap:\s*anywhere/);
    expect(label).not.toMatch(/word-break:\s*break-all/);
    expect(label).toMatch(/overflow-wrap:\s*normal/);
  });

  it("keep a refused tile's name at text contrast, greying its mark and border", () => {
    const refused = rule('.nx-insert-panel [cmdk-item][data-refused="true"]');
    expect(refused).toMatch(/color:\s*var\(--nx-foreground\)/);
    expect(refused).toMatch(/border-style:\s*dashed/);
    const mark = rule(
      '.nx-insert-panel [cmdk-item][data-refused="true"] > .nx-block-icon'
    );
    expect(mark).toMatch(/background:\s*var\(--nx-muted\)/);
    expect(mark).toMatch(/color:\s*var\(--nx-muted-foreground\)/);
  });
});
