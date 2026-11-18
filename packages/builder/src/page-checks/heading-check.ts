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
  COMPONENT_INSTANCE_TYPE,
  MAX_DEPTH,
  resolveComponentInstances,
  walkNodes,
  type BlockNode,
  type DefinitionsById,
} from "@nextlyhq/blocks-engine";
import {
  pageOutline,
  type OutlineHeading,
  type OutlinePart,
} from "@nextlyhq/blocks-react";

import type { PageCheck, PageCheckResult, ResolvedPage } from "./page-checks";

/** The Heading block's type, whose Level setting holds its level. */
const HEADING_TYPE = "core/heading";

/** The page's nodes as drawn, and the placement each drawn node comes from. */
interface DrawnPage {
  readonly nodes: BlockNode[];
  /** A node drawn from a component, by id, to the page's placement of it. */
  readonly placementOf: ReadonlyMap<string, string>;
}

/**
 * The page's blocks with each of its component placements drawn as the
 * component's blocks, recording which placement each drawn block is from.
 * Placements are drawn one at a time so each is known by its own id.
 */
function drawnPage(
  nodes: readonly BlockNode[],
  definitions: DefinitionsById | undefined
): DrawnPage {
  const placementOf = new Map<string, string>();
  if (definitions === undefined) return { nodes: [...nodes], placementOf };
  const draw = (list: readonly BlockNode[], depth: number): BlockNode[] =>
    list.flatMap(node => {
      if (node.type === COMPONENT_INSTANCE_TYPE) {
        const drawn = resolveComponentInstances(
          { formatVersion: 1, kind: "page", nodes: [node] },
          definitions
        ).document.nodes;
        walkNodes(drawn, inner => placementOf.set(inner.id, node.id));
        return drawn;
      }
      if (node.slots === undefined || depth >= MAX_DEPTH) return [node];
      const slots = Object.fromEntries(
        Object.entries(node.slots).map(([slot, children]) => [
          slot,
          Array.isArray(children) ? draw(children, depth + 1) : children,
        ])
      );
      return [{ ...node, slots }];
    });
  return { nodes: draw(nodes, 0), placementOf };
}

/** Where a heading is, as a finding names it and points to it. */
function placeOf(
  heading: OutlineHeading,
  placementOf: ReadonlyMap<string, string>
): {
  readonly where: string;
  readonly at: Pick<PageCheckResult, "nodeId" | "fix">;
} {
  if (heading.area !== "content") {
    return { where: ` in the site ${heading.area}`, at: {} };
  }
  const placement = placementOf.get(heading.node.id);
  if (placement !== undefined) return { where: "", at: { nodeId: placement } };
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
  const drawn = drawnPage(page.document.nodes, page.definitions);
  const part = (area: "header" | "footer"): OutlinePart[] =>
    page.regions
      .filter(region => region.area === area)
      .map(region => ({ area, nodes: region.document.nodes }));
  const { headings } = pageOutline([
    ...part("header"),
    { area: "content", nodes: drawn.nodes },
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
    const place = placeOf(heading, drawn.placementOf);
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
