/**
 * The checks over what the caller knows of a page beyond its document
 * (`page-facts`): bindings that no longer fit, how much data the page reads
 * against its limit, parts it uses that aren't published, and a header or
 * footer it shows twice. Each reads its fact as handed in and finds nothing
 * where it is left out, so the words are the only thing decided here.
 *
 * @module page-checks/fact-checks
 */
import {
  COMPONENT_INSTANCE_TYPE,
  walkNodes,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import {
  pageDataCount,
  readBudgetStanding,
  READ_KIND_WORDS,
  unreadBlocks,
  type PageReadReport,
} from "../shell/read-budget";

import type { PageCheck, PageCheckResult, ResolvedPage } from "./page-checks";
import type { UnpublishedPart } from "./page-facts";

/** The page's bindings that no longer fit, as "Bindings to fix" lists them. */
export const BINDINGS_TO_FIX_CHECK: PageCheck = {
  id: "bindings-to-fix",
  group: "content",
  run: page =>
    (page.facts.bindingsToFix ?? []).map(binding => ({
      nodeId: binding.nodeId,
      part: binding.prop,
      what: `Binding no longer fits: ${binding.where}`,
      why: binding.change,
      todo: "Bind it to a field again, or unbind it.",
    })),
};

/** The line under Content and data: the page's data against its limit. */
function pageDataNote(page: ResolvedPage): string | undefined {
  const fact = page.facts.pageData;
  if (fact === undefined) return undefined;
  if (fact.state === "counting") return "Page data: counting…";
  if (fact.state === "failed") return "Page data: couldn’t count";
  return pageDataCount(fact.report);
}

/** What a block over the limit misses, in the meter's words, as one line. */
function missedWords(what: readonly (keyof typeof READ_KIND_WORDS)[]): string {
  return what.map(kind => READ_KIND_WORDS[kind].unread).join(". ");
}

/** The blocks the page's data runs out before, each named. */
function overLimit(report: PageReadReport): PageCheckResult[] {
  const why = `The page reads more data than the site allows (${pageDataCount(report)}), so on the live page this block shows empty.`;
  const todo =
    "Show fewer entries in a list, or move some blocks to another page.";
  const rows = unreadBlocks(report);
  // Refused reads with no block to name: the page as a whole is over.
  if (rows.length === 0) {
    return [{ what: "Page data over the limit", why, todo }];
  }
  return rows.map(row => ({
    nodeId: row.nodeId,
    what: `Over the page data limit: ${missedWords(row.what)}`,
    why,
    todo,
  }));
}

/**
 * How much data the page reads against its limit, always as the group's
 * line, and over the limit an item for each block that then shows empty:
 * the same count and standing as the top bar's meter, never a second one.
 * A page that used exactly its allowance stands "over" for the meter, since
 * its next read would be refused, but missed nothing: an item needs a read
 * that was refused.
 */
export const PAGE_DATA_CHECK: PageCheck = {
  id: "page-data",
  group: "content",
  note: pageDataNote,
  run: page => {
    const fact = page.facts.pageData;
    if (fact?.state !== "counted") return [];
    const { report } = fact;
    const missed = report.refused > 0 || report.unread.length > 0;
    return missed && readBudgetStanding(report) === "over"
      ? overLimit(report)
      : [];
  },
};

/** The page's first placement of the component `id`, where it places one. */
function placementOf(
  nodes: readonly BlockNode[],
  id: string
): string | undefined {
  let found: string | undefined;
  walkNodes(nodes as BlockNode[], node => {
    if (
      found === undefined &&
      node.type === COMPONENT_INSTANCE_TYPE &&
      node.props.componentId === id
    ) {
      found = node.id;
    }
  });
  return found;
}

/** What to do about a part that isn't live, for who may and may not publish it. */
function publishWords(part: UnpublishedPart): string {
  return part.mayPublish
    ? "Publish it: when you publish the page, you're offered to publish it too."
    : "Ask someone who can publish it to do so.";
}

/** One part the page uses that isn't published. */
function unpublishedResult(
  part: UnpublishedPart,
  page: ResolvedPage
): PageCheckResult {
  const title = part.title ?? "Untitled";
  if (part.kind === "layout") {
    return {
      part: `layout:${part.id}`,
      what: `Header & footer not published: ${title}`,
      why: "Visitors see the page without this header and footer until it's live.",
      todo: publishWords(part),
    };
  }
  const nodeId = placementOf(page.document.nodes, part.id);
  return {
    ...(nodeId === undefined ? {} : { nodeId }),
    part: `component:${part.id}`,
    what: `Component not published: ${title}`,
    why: "Visitors don't see it on the live page until it's published.",
    todo: publishWords(part),
  };
}

/** The components and header & footer set the page uses that aren't live. */
export const UNPUBLISHED_PARTS_CHECK: PageCheck = {
  id: "unpublished-parts",
  group: "publishing",
  run: page =>
    (page.facts.unpublished ?? []).map(part => unpublishedResult(part, page)),
};

/** A header or footer the page shows twice: the set's and its own. */
export const DOUBLED_REGIONS_CHECK: PageCheck = {
  id: "doubled-regions",
  group: "content",
  run: page =>
    (page.facts.doubledRegions ?? []).map(region => {
      // Selects the page's own block, which is the one the author can remove.
      const nodeId = region.nodeIds[0];
      return {
        ...(nodeId === undefined ? {} : { nodeId }),
        part: region.area,
        what: `Two ${region.area}s on this page`,
        why: `${region.said} Visitors see both.`,
        todo: `Remove the page's own ${region.area} block, or change the header & footer in Page settings.`,
      };
    }),
};
