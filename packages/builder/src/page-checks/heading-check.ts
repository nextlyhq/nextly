/**
 * The headings check: a page with no main heading (H1), with more than one,
 * or with a heading that skips a level, judged in the order a visitor reads
 * the page, the site's header before it and its footer after.
 *
 * Screen reader users move through a page by its headings, and the main
 * heading says what the page is. A Heading block's level is read from its
 * Level setting; a rich text block's own headings are read in place.
 *
 * @module page-checks/heading-check
 */
import { walkNodes, type BlockDocument } from "@nextlyhq/blocks-engine";

import type {
  PageCheck,
  PageCheckResult,
  PageRegionDocument,
  ResolvedPage,
} from "./page-checks";
import { eachRichTextNode } from "./rich-text-parts";

/** The Heading block's type, whose Level setting holds its level. */
const HEADING_TYPE = "core/heading";

/** One heading a visitor reads, where it is and whether a setting fixes it. */
interface ReadHeading {
  readonly level: number;
  /** The page's block it is, or in; absent for one in the header or footer. */
  readonly nodeId?: string;
  /** Where it is when not on the page itself. */
  readonly region?: PageRegionDocument["area"];
  /** Whether its level is the block's Level setting (not inside rich text). */
  readonly setting: boolean;
}

/** A level as a number from "h1" to "h6", or undefined for anything else. */
function levelOf(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^h([1-6])$/.exec(value);
  return match === null ? undefined : Number(match[1]);
}

/** The headings of one document, in reading order. */
function headingsIn(
  document: BlockDocument,
  region?: PageRegionDocument["area"]
): ReadHeading[] {
  const read: ReadHeading[] = [];
  const at = (nodeId: string) =>
    region === undefined ? { nodeId } : { region };
  walkNodes(document.nodes, node => {
    if (node.type === HEADING_TYPE) {
      const level = levelOf(node.props.level);
      if (level !== undefined) {
        read.push({ level, setting: true, ...at(node.id) });
      }
    }
    eachRichTextNode(node, part => {
      const level = part.type === "heading" ? levelOf(part.tag) : undefined;
      if (level !== undefined) {
        read.push({ level, setting: false, ...at(node.id) });
      }
    });
  });
  return read;
}

/** The page's headings with the header's before and the footer's after. */
function headingsOf(page: ResolvedPage): ReadHeading[] {
  const around = (area: PageRegionDocument["area"]) =>
    page.regions
      .filter(region => region.area === area)
      .flatMap(region => headingsIn(region.document, area));
  return [
    ...around("header"),
    ...headingsIn(page.document),
    ...around("footer"),
  ];
}

/** Where a heading is, as a finding names it and points to it. */
function placeOf(heading: ReadHeading): {
  readonly where: string;
  readonly at: Pick<PageCheckResult, "nodeId" | "fix">;
} {
  if (heading.region !== undefined) {
    return { where: ` in the site ${heading.region}`, at: {} };
  }
  return {
    where: "",
    at: {
      ...(heading.nodeId === undefined ? {} : { nodeId: heading.nodeId }),
      ...(heading.setting ? { fix: { tab: "content", id: "level" } } : {}),
    },
  };
}

/** The finding for an H1 after the first one. */
function secondMain(heading: ReadHeading): PageCheckResult {
  const { where, at } = placeOf(heading);
  return {
    ...at,
    part: "second-h1",
    what: `More than one main heading (H1)${where}`,
    why: "A page has one main topic. Two main headings leave screen reader users unsure which one is the page’s title.",
    todo: "Keep one Heading 1 and set the others to Heading 2.",
  };
}

/** The finding for a heading more than one level below the one before. */
function skipped(heading: ReadHeading, before: number): PageCheckResult {
  const { where, at } = placeOf(heading);
  return {
    ...at,
    part: "skipped",
    what: `Heading skips a level${where}: H${String(before)}, then H${String(heading.level)}`,
    why: "People who move through the page by its headings may think they missed a section.",
    todo: `Set this heading to Heading ${String(before + 1)}, or add the level in between.`,
  };
}

/** The page's main heading problems, page-wide first, then in reading order. */
function headingFindings(page: ResolvedPage): PageCheckResult[] {
  const headings = headingsOf(page);
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
    if (heading.level === 1) {
      if (mainSeen) found.push(secondMain(heading));
      mainSeen = true;
    }
    const before = headings[index - 1]?.level;
    if (before !== undefined && heading.level > before + 1) {
      found.push(skipped(heading, before));
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
