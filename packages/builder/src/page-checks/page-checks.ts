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
  blockDefaultsOf,
  getBlock,
  resolveComponentInstances,
  walkNodes,
  type AnyBlockDefinition,
  type BlockDocument,
  type BlockNode,
  type DefinitionsById,
  type RegionArea,
  type ResolvedBlockNode,
  type NamedClass,
  type NodeStyles,
  type SiteTokenSet,
} from "@nextlyhq/blocks-engine";

import {
  revealedDefinitions,
  revealedForCanvas,
} from "../conditions/applied-conditions";
import type { AskedSetting } from "../editor-asks";
import { layerLabel } from "../panels/layers/layers";

import type { PageFacts } from "./page-facts";

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
  /** What the editor calls it, such as "Site header · Main", where known. */
  readonly label?: string;
  /** Where it is changed, where the caller can say: its editor's address. */
  readonly edit?: PageCheckLink;
}

/** A link out of the editor, as a finding offers one: its address and words. */
export interface PageCheckLink {
  readonly href: string;
  /** What the link says. */
  readonly text: string;
  /** Its accessible name, saying where it goes. */
  readonly name: string;
}

/** A region as the checks read it, and as it is stored. */
export interface ResolvedRegion extends PageRegionDocument {
  /**
   * The region as stored, its placements unresolved: what a read names, a
   * component placement among them, where `document` draws its blocks.
   */
  readonly stored: BlockDocument;
}

/** A region as the checks read it: its placements drawn as their blocks. */
function composedRegion(region: PageRegionDocument): ResolvedRegion {
  if (region.definitions === undefined) {
    return { ...region, stored: region.document };
  }
  const { definitions, ...rest } = region;
  return {
    ...rest,
    document: resolveComponentInstances(region.document, definitions).document,
    stored: region.document,
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
  /**
   * The definitions the page's own component placements are drawn from, so
   * a check that reads what the page draws can read inside them.
   */
  readonly definitions?: DefinitionsById;
  /**
   * The site's variables, light and dark, which a colour written as one is
   * read through; absent where the caller has none, and a colour that needs
   * them is then not judged.
   */
  readonly tokens?: SiteTokenSet;
  /**
   * The site's shared styles, among them its edits to a block type's own
   * look, which a block is drawn with under its own values.
   */
  readonly namedClasses?: readonly NamedClass[];
  /**
   * What the caller knows of the page beyond its document: its bindings
   * that no longer fit, its count of data, the parts it uses that aren't
   * live, a header or footer it shows twice. A check of a fact the caller
   * leaves out finds nothing.
   */
  readonly facts?: PageFacts;
}

/** The page as every check is handed it, its definitions resolved. */
export interface ResolvedPage {
  readonly document: BlockDocument;
  /**
   * The page's blocks as it draws them: its component placements drawn as
   * their components' blocks, under the page's own limits, where the caller
   * gave the definitions; the stored blocks otherwise. A check reads these,
   * and a finding on a block a component drew is moved to its placement.
   */
  readonly drawn: readonly BlockNode[];
  readonly blocks: (type: string) => AnyBlockDefinition | undefined;
  /** The header and footer drawn around it; none where none is known. */
  readonly regions: readonly ResolvedRegion[];
  /** The page's component definitions, where the caller knows them. */
  readonly definitions?: DefinitionsById;
  /** The site's variables, where the caller knows them. */
  readonly tokens?: SiteTokenSet;
  /** The site's edits to each block type's own look, by type. */
  readonly siteLooks: Readonly<Record<string, NodeStyles>>;
  /** What the caller knows of the page beyond its document; none given, none. */
  readonly facts: PageFacts;
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
  /**
   * The tab of the document's own settings that fixes it, by its id, where
   * the fix is there rather than on a block (a plugin's tab of Page settings).
   */
  readonly settingsTab?: string;
  /**
   * Where the fix is outside this editor, as a link the item is instead,
   * for a block it cannot select (a header's, changed in its own editor).
   */
  readonly opens?: PageCheckLink;
}

/** One check: an id, the group it reports in, and what it finds. */
export interface PageCheck {
  /** Stable and unique among the checks run together. */
  readonly id: string;
  readonly group: PageCheckGroup;
  /** The problems on the page, in page order. Pure: no DOM, no writes. */
  readonly run: (page: ResolvedPage) => readonly PageCheckResult[];
  /**
   * A line the list shows under the group's name whatever is found, such as
   * how much data the page reads; never counted as an item. Pure, as `run`.
   */
  readonly note?: (page: ResolvedPage) => string | undefined;
}

/** A check's line under its group's name. */
export interface PageCheckNote {
  readonly check: string;
  readonly group: PageCheckGroup;
  readonly text: string;
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
  /** The checks' lines under their groups' names, in the checks' order. */
  readonly notes: readonly PageCheckNote[];
}

/** One group of the list, with its findings. */
export interface PageCheckGroupView {
  readonly group: PageCheckGroup;
  readonly label: string;
  readonly findings: readonly PageFinding[];
  /** The lines under its name, which are not items. */
  readonly notes: readonly string[];
}

/**
 * Each drawn block a component drew, by id, to the page's placement of it:
 * the resolver marks every one (`instanceOf`), and leaves the page's own
 * blocks unmarked, slot content a placement holds among them.
 */
function placementsOf(
  drawn: readonly BlockNode[]
): ReadonlyMap<string, string> {
  const placements = new Map<string, string>();
  walkNodes(drawn as BlockNode[], node => {
    const placement = (node as ResolvedBlockNode).instanceOf;
    if (placement !== undefined) placements.set(node.id, placement);
  });
  return placements;
}

/**
 * A finding as the page knows it: one on a block a component drew points at
 * the placement, which is what the author can select, and opens no setting,
 * which is the component's to change.
 */
function onThePage(
  result: PageCheckResult,
  placementOf: ReadonlyMap<string, string>
): PageCheckResult {
  const placement =
    result.nodeId === undefined ? undefined : placementOf.get(result.nodeId);
  if (placement === undefined) return result;
  return {
    nodeId: placement,
    ...(result.part === undefined ? {} : { part: result.part }),
    what: result.what,
    why: result.why,
    todo: result.todo,
  };
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
 * The page's blocks as the editing canvas draws them: every conditioned
 * block drawn with its conditions lifted, on the page and in the components
 * it places (`revealedForCanvas`, `revealedDefinitions`), so a block the
 * author sees on the canvas is judged, whatever its conditions decide.
 */
function drawnNodesOf(page: CheckedPage): readonly BlockNode[] {
  const revealed = revealedForCanvas(page.document, undefined);
  if (page.definitions === undefined) return revealed.nodes;
  return resolveComponentInstances(
    revealed,
    revealedDefinitions(revealed, page.definitions, undefined)
  ).document.nodes;
}

/**
 * The page as every check is handed it: drawn once, its component
 * placements as their blocks where the definitions are given, its header and
 * footer read as their components draw them.
 */
function resolvedPageOf(page: CheckedPage): ResolvedPage {
  return {
    document: page.document,
    drawn: drawnNodesOf(page),
    blocks: page.blocks ?? getBlock,
    regions: (page.regions ?? []).map(composedRegion),
    ...(page.definitions === undefined
      ? {}
      : { definitions: page.definitions }),
    ...(page.tokens === undefined ? {} : { tokens: page.tokens }),
    siteLooks: blockDefaultsOf(page.namedClasses ?? []),
    facts: page.facts ?? {},
  };
}

/**
 * Run the checks over a page. A check that throws is named in `notRun` and
 * the rest still run, so one broken check never hides the others' findings.
 */
export function runPageChecks(
  page: CheckedPage,
  checks: readonly PageCheck[]
): PageCheckReport {
  const resolved = resolvedPageOf(page);
  const { drawn } = resolved;
  const order = pageOrder(page.document);
  const placementOf = placementsOf(drawn);
  const taken = new Set<string>();
  const found: PageFinding[] = [];
  const notRun: string[] = [];
  const notes: PageCheckNote[] = [];
  for (const check of checks) {
    let results: readonly PageCheckResult[];
    let note: string | undefined;
    try {
      results = check.run(resolved);
      note = check.note?.(resolved);
    } catch {
      notRun.push(check.id);
      continue;
    }
    if (note !== undefined) {
      notes.push({ check: check.id, group: check.group, text: note });
    }
    for (const drawnResult of results) {
      const result = onThePage(drawnResult, placementOf);
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
  return { findings, notRun, notes };
}

/**
 * The list's groups: Accessibility, Content and data and Publishing always,
 * and Search only where one of the checks offered reports in it, each with
 * its findings in order. Derived from the findings, never counted apart.
 */
export function pageCheckGroups(
  findings: readonly PageFinding[],
  checks: readonly Pick<PageCheck, "group">[],
  notes: readonly PageCheckNote[] = []
): PageCheckGroupView[] {
  const offered = new Set(checks.map(check => check.group));
  return GROUP_ORDER.filter(
    group => CORE_GROUPS.includes(group) || offered.has(group)
  ).map(group => ({
    group,
    label: GROUP_LABELS[group],
    findings: findings.filter(finding => finding.group === group),
    notes: notes.filter(note => note.group === group).map(note => note.text),
  }));
}
