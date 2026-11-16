/**
 * The pages the builder's speed check measures, checked before any seed
 * writes them: each page holds exactly its stated number of blocks, the large
 * one is shaped like a real marketing page, every document passes the
 * engine's strict validation, and the blocks the speed script clicks are
 * there. A change to any of this changes what every later measurement means,
 * so it has to be deliberate.
 */
import { describe, expect, it } from "vitest";

import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import {
  validateDocument,
  type BlockDocument,
  type BlockNode,
  type NestingSource,
} from "@nextlyhq/blocks-engine";

import {
  blocksIn,
  SPEED_FIXTURE_BLOCKS,
  SPEED_FIXTURE_IDS,
  speedCardDocument,
  speedFooterDocument,
  speedHeaderDocument,
  speedPageDocument,
  type SpeedFixturePage,
} from "../../seed/speed-fixture";
import { SITE_STYLE_DEFAULTS } from "../../src/lib/site-style-defaults";

interface Definition {
  name: string;
  parent?: readonly string[];
  slots?: Record<string, { allow?: readonly string[] } | undefined>;
}

/** The block a placement is stored as, which the page builder registers. */
const INSTANCE = "nextly/component-instance";

const BY_NAME = new Map(
  (coreBlocks as unknown as Definition[]).map(block => [block.name, block])
);

const NESTING: NestingSource = {
  parentsOf: type => BY_NAME.get(type)?.parent,
  slotAllowOf: (parentType, slot) =>
    (BY_NAME.get(parentType)?.slots?.[slot] as { allow?: readonly string[] })
      ?.allow,
};

function errorsOf(document: BlockDocument): string[] {
  return validateDocument(document, {
    mode: "strict",
    breakpoints: SITE_STYLE_DEFAULTS.breakpoints,
    registry: { has: type => BY_NAME.has(type) || type === INSTANCE },
    nesting: NESTING,
  })
    .issues.filter(issue => issue.severity === "error")
    .map(issue => `${issue.path}: ${issue.code} — ${issue.message}`);
}

const MEDIA = ["media-1", "media-2", "media-3"];
const PAGES = Object.keys(SPEED_FIXTURE_BLOCKS) as SpeedFixturePage[];
const page = (which: SpeedFixturePage) =>
  speedPageDocument(which, MEDIA, "card-1");
const types = (nodes: readonly BlockNode[]) =>
  blocksIn(nodes).map(node => node.type);

describe("the speed fixture", () => {
  it.each(PAGES)(
    "the %s page holds exactly its stated number of blocks",
    which => {
      expect(blocksIn(page(which).nodes)).toHaveLength(
        SPEED_FIXTURE_BLOCKS[which]
      );
    }
  );

  it("states the sizes the speed check measures: 150, and 4, 20 and 38 for the curve", () => {
    expect(SPEED_FIXTURE_BLOCKS).toEqual({
      large: 150,
      small: 4,
      twenty: 20,
      thirtyEight: 38,
    });
  });

  it.each([
    ["the header", speedHeaderDocument(MEDIA)],
    ["the footer", speedFooterDocument(MEDIA)],
    ["the card", speedCardDocument(MEDIA)],
    ...PAGES.map(which => [`the ${which} page`, page(which)] as const),
  ])("%s passes the engine's strict validation", (_, document) => {
    expect(errorsOf(document)).toEqual([]);
  });

  it.each(PAGES)("the %s page names each block once", which => {
    const ids = blocksIn(page(which).nodes).map(node => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("the large page is shaped like a marketing page", () => {
    const all = types(page("large").nodes);
    const count = (type: string) => all.filter(t => t === type).length;
    // The card component, placed six times.
    expect(count(INSTANCE)).toBe(6);
    expect(count("core/accordion")).toBe(1);
    expect(count("core/form")).toBe(1);
    expect(count("core/collection-loop")).toBe(1);
    expect(count("core/card")).toBeGreaterThanOrEqual(3);
    expect(count("core/image")).toBeGreaterThanOrEqual(10);
    expect(count("core/button")).toBeGreaterThanOrEqual(5);
  });

  it("the Layout's header and footer each carry an image and buttons", () => {
    for (const region of [
      speedHeaderDocument(MEDIA),
      speedFooterDocument(MEDIA),
    ]) {
      const all = types(region.nodes);
      expect(all).toContain("core/image");
      expect(
        all.filter(type => type === "core/button").length
      ).toBeGreaterThanOrEqual(2);
    }
  });

  it("every page holds the blocks the speed script selects", () => {
    for (const which of PAGES) {
      const ids = new Set(blocksIn(page(which).nodes).map(node => node.id));
      expect(ids.has(SPEED_FIXTURE_IDS.heading), which).toBe(true);
      expect(ids.has(SPEED_FIXTURE_IDS.lead), which).toBe(true);
    }
    const large = new Set(blocksIn(page("large").nodes).map(node => node.id));
    for (const id of SPEED_FIXTURE_IDS.quick)
      expect(large.has(id), id).toBe(true);
  });
});
