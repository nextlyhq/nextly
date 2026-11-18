/**
 * Page checks: what on the open page needs the author's attention before it
 * goes out, as one list grouped Accessibility, Content and data, Publishing,
 * and Search where a check offers it.
 *
 * The model only: the check contract, the finding each check reports with
 * where its fix is, the groups, and the runner over a document. No React and
 * no DOM, so a script, a route or an agent asking about a stored page gets
 * the findings the editor lists for the draft on screen.
 *
 * A finding never blocks anything. The editor counts them beside Publish and
 * lists them; Save and Publish read none of this.
 *
 * @module page-checks/page-checks
 * @experimental The checks and the provider point grow with later checks.
 */
import {
  getBlock,
  resolveComponentInstances,
  walkNodes,
  type AnyBlockDefinition,
  type BlockDocument,
  type BlockNode,
  type DefinitionsById,
  type RegionArea,
} from "@nextlyhq/blocks-engine";

import type { AskedSetting } from "../editor-asks";
import { layerLabel } from "../panels/layers/layers";

/** The groups a finding is listed under. */
export type PageCheckGroup =
  | "accessibility"
  | "content"
  | "publishing"
  | "search";

/** Each group's name, in the list's order. */
const GROUP_LABELS: Readonly<Record<PageCheckGroup, string>> = {
  accessibility: "Accessibility",
  content: "Content and data",
  publishing: "Publishing",
  search: "Search",
};

/** The groups listed on every page, whatever checks are offered. */
const CORE_GROUPS: readonly PageCheckGroup[] = [
  "accessibility",
  "content",
  "publishing",
];

/** The groups in the list's order. */
const GROUP_ORDER = Object.keys(GROUP_LABELS) as PageCheckGroup[];

/**
 * A header or footer drawn around the page, as its site's set places it: a
 * check that judges the page as a visitor reads it, top to bottom, reads
 * the header's blocks before the page's and the footer's after.
 */
export interface PageRegionDocument {
  readonly area: RegionArea;
  readonly document: BlockDocument;
  /**
   * The definitions its component placements are drawn from, where it is
   * placed as a component, as a set's header is: the checks then read the
   * blocks the component draws, not the one placement.
   */
  readonly definitions?: DefinitionsById;
}

/** A region as the checks read it: its placements drawn as their blocks. */
function composedRegion(region: PageRegionDocument): PageRegionDocument {
  if (region.definitions === undefined) return region;
  return {
    area: region.area,
    document: resolveComponentInstances(region.document, region.definitions)
      .document,
  };
}

/** The page a check reads. */
export interface CheckedPage {
  /** The draft as it stands, unsaved changes included, or a stored page. */
  readonly document: BlockDocument;
  /**
   * The definitions the page is drawn with, by block type: the registry this
   * process holds unless the caller resolves blocks its own way.
   */
  readonly blocks?: (type: string) => AnyBlockDefinition | undefined;
  /** The header and footer drawn around it, where the caller knows them. */
  readonly regions?: readonly PageRegionDocument[];
}

/** The page as every check is handed it, its definitions resolved. */
export interface ResolvedPage {
  readonly document: BlockDocument;
  readonly blocks: (type: string) => AnyBlockDefinition | undefined;
  /** The header and footer drawn around it; none where none is known. */
  readonly regions: readonly PageRegionDocument[];
}

/** What one check reports about one problem. */
export interface PageCheckResult {
  /** The block it is about; absent for the page as a whole. */
  readonly nodeId?: string;
  /** Which of several problems a check finds on one block this is. */
  readonly part?: string;
  /** What is wrong, as a short line. */
  readonly what: string;
  /** Why it matters, and to whom. */
  readonly why: string;
  /** What to do about it. */
  readonly todo: string;
  /**
   * The block's setting that fixes it, as the settings index names it;
   * absent where no one setting does, and the block alone is selected.
   */
  readonly fix?: AskedSetting;
}

/** One check: an id, the group it reports in, and what it finds. */
export interface PageCheck {
  /** Stable and unique among the checks run together. */
  readonly id: string;
  readonly group: PageCheckGroup;
  /** The problems on the page, in page order. Pure: no DOM, no writes. */
  readonly run: (page: ResolvedPage) => readonly PageCheckResult[];
}

/** One problem as the list shows it. */
export interface PageFinding extends PageCheckResult {
  /** Which check found it. */
  readonly check: string;
  readonly group: PageCheckGroup;
  /** The same problem keeps its key from one run to the next. */
  readonly key: string;
  /** The block's name as Layers shows it, where the finding is on one. */
  readonly block?: string;
}

/** What a run found, and which checks could not run. */
export interface PageCheckReport {
  /** In the list's order: by group, then by where the block is on the page. */
  readonly findings: readonly PageFinding[];
  /** The ids of checks that threw, so the list can say they didn't run. */
  readonly notRun: readonly string[];
}

/** One group of the list, with its findings. */
export interface PageCheckGroupView {
  readonly group: PageCheckGroup;
  readonly label: string;
  readonly findings: readonly PageFinding[];
}

/** Each block's place on the page, by id, and the node itself. */
function pageOrder(document: BlockDocument): Map<string, [number, BlockNode]> {
  const order = new Map<string, [number, BlockNode]>();
  walkNodes(document.nodes, node => {
    if (!order.has(node.id)) order.set(node.id, [order.size, node]);
  });
  return order;
}

/** A key for the result, unique among those already given. */
function keyOf(check: string, result: PageCheckResult, taken: Set<string>) {
  const base = `${check}:${result.nodeId ?? ""}:${result.part ?? ""}`;
  let key = base;
  // A check naming one problem twice still lists it twice, each its own row.
  for (let repeat = 2; taken.has(key); repeat += 1) {
    key = `${base}#${String(repeat)}`;
  }
  taken.add(key);
  return key;
}

/**
 * Run the checks over a page. A check that throws is named in `notRun` and
 * the rest still run, so one broken check never hides the others' findings.
 */
export function runPageChecks(
  page: CheckedPage,
  checks: readonly PageCheck[]
): PageCheckReport {
  const resolved: ResolvedPage = {
    document: page.document,
    blocks: page.blocks ?? getBlock,
    regions: (page.regions ?? []).map(composedRegion),
  };
  const order = pageOrder(page.document);
  const taken = new Set<string>();
  const found: PageFinding[] = [];
  const notRun: string[] = [];
  for (const check of checks) {
    let results: readonly PageCheckResult[];
    try {
      results = check.run(resolved);
    } catch {
      notRun.push(check.id);
      continue;
    }
    for (const result of results) {
      const node =
        result.nodeId === undefined ? undefined : order.get(result.nodeId)?.[1];
      found.push({
        ...result,
        check: check.id,
        group: check.group,
        key: keyOf(check.id, result, taken),
        ...(node === undefined
          ? {}
          : { block: layerLabel(node, resolved.blocks) }),
      });
    }
  }
  // Page-wide findings first in their group, then the page's blocks in order.
  const place = (finding: PageFinding): number =>
    finding.nodeId === undefined ? -1 : (order.get(finding.nodeId)?.[0] ?? -1);
  const findings = found
    .map((finding, index) => ({ finding, index }))
    .sort(
      (a, b) =>
        GROUP_ORDER.indexOf(a.finding.group) -
          GROUP_ORDER.indexOf(b.finding.group) ||
        place(a.finding) - place(b.finding) ||
        a.index - b.index
    )
    .map(each => each.finding);
  return { findings, notRun };
}

/**
 * The list's groups: Accessibility, Content and data and Publishing always,
 * and Search only where one of the checks offered reports in it, each with
 * its findings in order. Derived from the findings, never counted apart.
 */
export function pageCheckGroups(
  findings: readonly PageFinding[],
  checks: readonly Pick<PageCheck, "group">[]
): PageCheckGroupView[] {
  const offered = new Set(checks.map(check => check.group));
  return GROUP_ORDER.filter(
    group => CORE_GROUPS.includes(group) || offered.has(group)
  ).map(group => ({
    group,
    label: GROUP_LABELS[group],
    findings: findings.filter(finding => finding.group === group),
  }));
}
