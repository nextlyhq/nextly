import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { chromeStylesheetSource } from "../../styles/chrome-stylesheet";

import { GRID_COLUMNS } from "./insert-panel-tiles";

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
  it("sit two across", () => {
    expect(GRID_COLUMNS).toBe(2);
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

  it("break a name only between its words, unless one word alone is wider than the tile", () => {
    const label = rule(".nx-insert-panel__label");
    // `break-word` breaks a word only when it cannot fit on a line of its
    // own, so a plugin's "CollectionLoop" stays inside its tile while every
    // name that fits keeps its words whole; `break-all` breaks every word.
    expect(label).not.toMatch(/overflow-wrap:\s*anywhere/);
    expect(label).not.toMatch(/word-break:\s*break-all/);
    expect(label).toMatch(/overflow-wrap:\s*break-word/);
    // Capped at its tile, so a word broken there breaks inside the tile: a
    // centred label in a picture tile would otherwise grow to its longest
    // word and spill out on both sides.
    expect(label).toMatch(/max-width:\s*100%/);
  });

  it("keep a refused tile's name at text contrast, greying its mark and border", () => {
    const refused = rule('.nx-insert-panel [cmdk-item][data-refused="true"]');
    expect(refused).toMatch(/color:\s*var\(--nx-foreground\)/);
    expect(refused).toMatch(/border-style:\s*dashed/);
    const mark = rule(
      '.nx-insert-panel [cmdk-item][data-refused="true"] > .nx-block-icon'
    );
    // A gray tint of its own, apart from the muted surface the refused tile
    // takes on hover, so the square stays drawn under the pointer.
    expect(mark).toMatch(
      /background:\s*color-mix\([^;]*var\(--nx-muted-foreground\)/
    );
    expect(mark).not.toMatch(/background:\s*var\(--nx-muted\)/);
    expect(mark).toMatch(/color:\s*var\(--nx-muted-foreground\)/);
  });

  it("keep a group's heading pinned over its tiles while they scroll", () => {
    const heading = rule(".nx-insert-panel [cmdk-group] [cmdk-group-heading]");
    expect(heading).toMatch(/position:\s*sticky/);
    expect(heading).toMatch(/top:\s*0/);
    // Opaque, on the panel's own surface, so the tiles pass under it unseen.
    expect(heading).toMatch(/background:\s*var\(--nx-builder-panel\)/);
    // Written as it is ("Text & lists"): the shared command group shouts its
    // headings, so the panel's says so outright.
    expect(heading).toMatch(/text-transform:\s*none/);
    expect(heading).toMatch(/letter-spacing:\s*normal/);
  });

  it("set the search in a bordered box with a focus ring", () => {
    const box = rule(".nx-insert-panel__search [cmdk-input-wrapper]");
    expect(box).toMatch(/border:\s*1px solid var\(--nx-builder-border\)/);
    expect(box).toMatch(/border-radius:/);
    const focused = rule(
      ".nx-insert-panel__search [cmdk-input-wrapper]:focus-within"
    );
    expect(focused).toMatch(/border-color:\s*var\(--nx-ring\)/);
    expect(focused).toMatch(/box-shadow:/);
  });

  it("draw saved sections as preview cards, one across in a narrow panel and two in a wider one", () => {
    const cards = rule(
      ".nx-insert-panel [cmdk-group-items]:has(> [cmdk-item] > .nx-picture)"
    );
    // As many as fit at a card's least width: one in the narrowest panel,
    // two at its default, each wider than a block's tile can be.
    expect(cards).toMatch(
      /grid-template-columns:\s*repeat\(auto-fill, minmax\(8\.5rem, 1fr\)\)/
    );
    const card = rule(".nx-insert-panel [cmdk-item]:has(> .nx-picture)");
    expect(card).toMatch(/align-items:\s*stretch/);
  });
});
