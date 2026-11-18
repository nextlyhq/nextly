/**
 * The headings check: a page with no main heading (H1), with more than one,
 * or with a heading that skips a level, judged in the order a visitor reads
 * the page, the site's header before it and its footer after.
 *
 * Screen reader users move through a page by its headings, and the main
 * heading says what the page is. Which headings a page draws, and at what
 * level, is the renderer's page outline (`pageOutline`), the one reading of
 * it the page's anchors and its table of contents use too, so the check and
 * the page cannot disagree. The page's own component placements are drawn as
 * their blocks, each heading inside one pointing back to the placement.
 *
 * @module page-checks/heading-check
 */
import {
  COLLECTION_LIST_TYPE,
  MAX_DEPTH,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import {
  pageOutline,
  type OutlineHeading,
  type OutlinePart,
} from "@nextlyhq/blocks-react";

import type { PageCheck, PageCheckResult, ResolvedPage } from "./page-checks";

/** The Heading block's type, whose Level setting holds its level. */
const HEADING_TYPE = "core/heading";

/** What a heading whose words come from a field is read with here. */
const BOUND_WORDS = "Bound heading";

/**
 * A Heading whose words are bound to a field, read as having words: the page
 * draws the entry's, and the outline lists only a heading with words.
 */
function withBoundWords(node: BlockNode): BlockNode {
  const { text } = node.props;
  const empty = typeof text !== "string" || text.trim() === "";
  if (
    node.type !== HEADING_TYPE ||
    node.bindings?.text === undefined ||
    !empty
  ) {
    return node;
  }
  return { ...node, props: { ...node.props, text: BOUND_WORDS } };
}

/** The drawn blocks, each bound Heading read with words, down the tree. */
function withBoundHeadings(list: readonly BlockNode[], depth = 0): BlockNode[] {
  return list.map(stored => {
    const node = withBoundWords(stored);
    if (node.slots === undefined || depth >= MAX_DEPTH) return node;
    const slots = Object.fromEntries(
      Object.entries(node.slots)
        // A Collection list draws its entries or its empty state, never both:
        // its entries are read, so the two can't count as one page.
        .filter(
          ([slot]) => node.type !== COLLECTION_LIST_TYPE || slot !== "empty"
        )
        .map(([slot, children]) => [
          slot,
          Array.isArray(children)
            ? withBoundHeadings(children, depth + 1)
            : children,
        ])
    );
    return { ...node, slots };
  });
}

/** Where a heading is, as a finding names it and points to it. */
function placeOf(heading: OutlineHeading): {
  readonly where: string;
  readonly at: Pick<PageCheckResult, "nodeId" | "fix">;
} {
  if (heading.area !== "content") {
    return { where: ` in the site ${heading.area}`, at: {} };
  }
  // One a component drew is moved to its placement by the runner.
  return {
    where: "",
    at: {
      nodeId: heading.node.id,
      // A Heading's level is its Level setting; one in rich text has none.
      ...(heading.node.type === HEADING_TYPE
        ? { fix: { tab: "content", id: "level" } }
        : {}),
    },
  };
}

/** The finding for an H1 after the first one. */
function secondMain(place: ReturnType<typeof placeOf>): PageCheckResult {
  return {
    ...place.at,
    part: "second-h1",
    what: `More than one main heading (H1)${place.where}`,
    why: "A page has one main topic. Two main headings leave screen reader users unsure which one is the page’s title.",
    todo: "Keep one Heading 1 and set the others to Heading 2.",
  };
}

/** The finding for a heading more than one level below the one before. */
function skipped(
  place: ReturnType<typeof placeOf>,
  before: number,
  level: number
): PageCheckResult {
  return {
    ...place.at,
    part: "skipped",
    what: `Heading skips a level${place.where}: H${String(before)}, then H${String(level)}`,
    why: "People who move through the page by its headings may think they missed a section.",
    todo: `Set this heading to Heading ${String(before + 1)}, or add the level in between.`,
  };
}

/** The page's heading problems, page-wide first, then in reading order. */
function headingFindings(page: ResolvedPage): PageCheckResult[] {
  const drawn = withBoundHeadings(page.drawn);
  const part = (area: "header" | "footer"): OutlinePart[] =>
    page.regions
      .filter(region => region.area === area)
      .map(region => ({
        area,
        nodes: withBoundHeadings(region.document.nodes),
      }));
  const { headings } = pageOutline([
    ...part("header"),
    { area: "content", nodes: drawn },
    ...part("footer"),
  ]);
  const found: PageCheckResult[] = [];
  if (!headings.some(heading => heading.level === 1)) {
    found.push({
      part: "no-h1",
      what: "Page has no main heading (H1)",
      why: "Screen reader users look for the main heading to learn what the page is about.",
      todo: "Set the page’s main title to Heading 1.",
    });
  }
  let mainSeen = false;
  headings.forEach((heading, index) => {
    const place = placeOf(heading);
    if (heading.level === 1) {
      if (mainSeen) found.push(secondMain(place));
      mainSeen = true;
    }
    const before = headings[index - 1]?.level;
    if (before !== undefined && heading.level > before + 1) {
      found.push(skipped(place, before, heading.level));
    }
  });
  return found;
}

/** No H1, a second H1, or a skipped level, across header, page and footer. */
export const HEADING_CHECK: PageCheck = {
  id: "headings",
  group: "accessibility",
  run: headingFindings,
};
