/**
 * The canvas with visibility conditions applied for the entry a template is
 * previewed with: which of the page's own blocks a visitor would see, and the
 * page as the canvas draws it then.
 *
 * Only the blocks that read the entry are judged. A block in a list's
 * per-entry slot reads each drawn item instead, and a block inside a placed
 * component is drawn from the component's own document, so both keep the
 * "Conditional" mark they carry while conditions are not applied.
 *
 * Every verdict is the engine's own (`evaluateConditions`), asked with the
 * entry as a visitor reads it, so the canvas answers as the published page
 * does. A block that is hidden is drawn as a one-line marker in its place,
 * keeping its id, so it stays selectable and its conditions can be changed.
 *
 * @module applied-conditions
 */
import {
  conditionScopeIn,
  DEFAULT_LIMITS,
  evaluateConditions,
  isPlainRecord,
  mapForest,
  revealConditioned,
  storedVisibilityOf,
  type BlockDocument,
  type BlockNode,
  type Condition,
  type ConditionDayStart,
  type ConditionEvaluation,
  type ConditionOp,
  type ConditionScope,
  type ConditionSubject,
  type NodeVisibility,
} from "@nextlyhq/blocks-engine";

import { storedGroups } from "./condition-checks";
import { gatedAsStored } from "./condition-gate";
import {
  conditionDraftOf,
  conditionLine,
  conditionSentence,
  type ConditionField,
} from "./condition-model";

/**
 * The type of the marker a hidden block is drawn as. Editor-only: it is never
 * stored, and only the canvas's renderer knows it.
 */
export const CONDITION_HIDDEN_TYPE = "nx-editor/condition-hidden";

/**
 * What a hidden block's marker shows: the block's name and why it is hidden,
 * in words, and whether that is because its conditions can't be checked.
 */
export type ConditionHiddenProps = {
  readonly name: string;
  readonly reason: string;
  readonly unchecked: boolean;
};

/**
 * The entry the conditions are checked against, as a visitor reads it.
 *
 * @experimental Settles with the editor's condition controls.
 */
export interface ConditionsPreview {
  /**
   * The entry's published values and the fields a visitor may read, or
   * `undefined` where a visitor reads no entry at all: one never published,
   * or one the public may not read. The page then hides every conditioned
   * block, as the published page does.
   */
  readonly subject: ConditionSubject | undefined;
  /** What the entry is called in words, lower case: "post". */
  readonly noun: string;
  /** The entry's fields as a condition reads them, for the reasons' words. */
  readonly fields: readonly ConditionField[];
  /** Where a site starts its days, for a date compared by day. */
  readonly dayStart?: ConditionDayStart;
}

/** A block the conditions hide, with what its marker says. */
export type HiddenBlock = ConditionHiddenProps & {
  readonly id: string;
};

/**
 * The page with its conditions applied.
 *
 * @experimental Settles with the editor's condition controls.
 */
export interface AppliedConditions {
  /** The page as the canvas draws it: hidden blocks as markers. */
  readonly document: BlockDocument;
  /** The judged blocks a visitor would see. */
  readonly shown: ReadonlySet<string>;
  /** The judged blocks a visitor would not, outermost first, in page order. */
  readonly hidden: readonly HiddenBlock[];
}

/** Where the page's own blocks read: the entry it is drawn for. */
const ENTRY_SCOPE: ConditionScope = { source: "entry", collection: undefined };

/**
 * The page with its conditions applied for the previewed entry: every block
 * judged, every conditioned block drawn (a shown one as itself, a hidden one
 * as its marker), as the canvas shows the page while conditions apply.
 *
 * @experimental Settles with the editor's condition controls.
 */
export function appliedConditionsOf(
  document: BlockDocument,
  preview: ConditionsPreview,
  nameOf: (node: BlockNode) => string
): AppliedConditions {
  const { shown, hidden } = judgedBlocks(document, preview, nameOf);
  const byId = new Map(hidden.map(block => [block.id, block]));
  // Every conditioned block is drawn, as the canvas draws them while
  // conditions are not applied; a hidden one then becomes its marker.
  const revealed = revealConditioned(document);
  const nodes =
    byId.size === 0
      ? revealed.nodes
      : mapForest(revealed.nodes, node => {
          const block = byId.get(node.id);
          return block === undefined ? node : markerFor(block);
        });
  return {
    document: nodes === revealed.nodes ? revealed : { ...revealed, nodes },
    shown,
    hidden,
  };
}

/** A hidden block's marker, keeping its id so the canvas selects the block. */
function markerFor(block: HiddenBlock): BlockNode {
  const props: ConditionHiddenProps = {
    name: block.name,
    reason: block.reason,
    unchecked: block.unchecked,
  };
  return { id: block.id, type: CONDITION_HIDDEN_TYPE, version: 1, props };
}

/** One block to visit, with what its conditions read. */
interface Visit {
  readonly node: unknown;
  readonly scope: ConditionScope;
}

/**
 * Every block of the page that reads the entry, judged: shown, or hidden with
 * its reason. A hidden block's own blocks are not judged, since none of them
 * is drawn.
 */
function judgedBlocks(
  document: BlockDocument,
  preview: ConditionsPreview,
  nameOf: (node: BlockNode) => string
): { shown: Set<string>; hidden: HiddenBlock[] } {
  const shown = new Set<string>();
  const hidden: HiddenBlock[] = [];
  walkScoped(document, (block, scope) => {
    if (scope.source !== "entry" || !gatedAsStored(block)) return true;
    const verdict = evaluateConditions(storedGate(block), inputOf(preview));
    if (verdict.shown) {
      shown.add(block.id);
      return true;
    }
    hidden.push({
      id: block.id,
      name: nameOf(block),
      ...reasonOf(block, verdict, preview),
    });
    return false;
  });
  return { shown, hidden };
}

/**
 * Which conditioned blocks a document holds: any at all, and any that reads
 * the entry it is drawn for, which is what applying conditions judges.
 *
 * @experimental Settles with the editor's condition controls.
 */
export function conditionedBlocksIn(document: BlockDocument): {
  readonly any: boolean;
  readonly readingEntry: boolean;
} {
  let any = false;
  let readingEntry = false;
  walkScoped(document, (block, scope) => {
    if (gatedAsStored(block)) {
      any = true;
      readingEntry ||= scope.source === "entry";
    }
    return !readingEntry;
  });
  return { any, readingEntry };
}

/**
 * Every block of a document, in page order, with what its conditions read:
 * the entry, or a list's item inside its per-entry slot (`conditionScopeIn`,
 * the save's and the renderer's one rule). `visit` answers whether to go on
 * into the block's own blocks. Bounded by the document limits, as any walk of
 * stored data is.
 */
function walkScoped(
  document: BlockDocument,
  visit: (block: BlockNode, scope: ConditionScope) => boolean
): void {
  const roots: unknown[] = Array.isArray(document.nodes) ? document.nodes : [];
  const stack: Visit[] = roots
    .map(node => ({ node, scope: ENTRY_SCOPE }))
    .reverse();
  let left = DEFAULT_LIMITS.maxNodes;
  while (stack.length > 0 && left > 0) {
    const next = stack.pop();
    left -= 1;
    if (next === undefined || !isBlock(next.node)) continue;
    if (visit(next.node, next.scope)) {
      stack.push(...childVisits(next.node, next.scope));
    }
  }
}

/** Whether a stored value is a block this walk can read. */
function isBlock(node: unknown): node is BlockNode {
  return isPlainRecord(node) && typeof node.id === "string";
}

/** A block's children, last first, each with what its conditions read. */
function childVisits(block: BlockNode, scope: ConditionScope): Visit[] {
  const slots: unknown = block.slots;
  if (!isPlainRecord(slots)) return [];
  const visits: Visit[] = [];
  for (const [slot, children] of Object.entries(slots)) {
    if (!Array.isArray(children)) continue;
    const inner = conditionScopeIn(block, slot, scope);
    for (const child of children as unknown[]) {
      visits.push({ node: child, scope: inner });
    }
  }
  return visits.reverse();
}

/**
 * The block's conditions as the published page judges them: a placement
 * gate stored on a block, which only the resolver writes, is removed first,
 * as the renderer removes it.
 */
function storedGate(block: BlockNode): Pick<BlockNode, "id" | "visibility"> {
  return {
    id: block.id,
    visibility: storedVisibilityOf(block.visibility) as NodeVisibility,
  };
}

/** What the engine judges a block's conditions against. */
function inputOf(
  preview: ConditionsPreview
): Parameters<typeof evaluateConditions>[1] {
  return {
    source: "entry",
    ...(preview.subject === undefined ? {} : { subject: preview.subject }),
    ...(preview.dayStart === undefined ? {} : { dayStart: preview.dayStart }),
  };
}

/**
 * Why a block is hidden, as its marker says it: the conditions that don't
 * hold for the entry, worded as the "Show when" rows word them; or that a
 * visitor reads no entry; or that its conditions can't be checked, which the
 * published page answers by hiding the block from everyone.
 */
function reasonOf(
  block: BlockNode,
  verdict: ConditionEvaluation,
  preview: ConditionsPreview
): { reason: string; unchecked: boolean } {
  if (verdict.issues.length > 0) {
    return {
      reason: "can’t be checked, so visitors never see it",
      unchecked: true,
    };
  }
  if (preview.subject === undefined) {
    return {
      reason: `hidden: this ${preview.noun} isn’t published yet`,
      unchecked: false,
    };
  }
  const groups = storedGroups(block);
  const only = groups?.length === 1 ? groups[0] : undefined;
  const failing =
    only === undefined
      ? []
      : only.filter(condition => !holds(block, condition, preview));
  const why =
    failing.length === 0
      ? "none of its condition groups hold"
      : failingWords(failing, preview.fields);
  return {
    reason: `hidden for this ${preview.noun}: ${why}`,
    unchecked: false,
  };
}

/** Whether one condition holds for the entry, as the engine judges it. */
function holds(
  block: BlockNode,
  condition: Condition,
  preview: ConditionsPreview
): boolean {
  return evaluateConditions(
    { id: block.id, visibility: { conditions: [[condition]] } },
    inputOf(preview)
  ).shown;
}

/**
 * The conditions that don't hold, as the first one's opposite and how many
 * more: "Category is not Guides, and 1 more".
 */
function failingWords(
  failing: readonly Condition[],
  fields: readonly ConditionField[]
): string {
  const [first] = failing;
  const words = first === undefined ? "" : oppositeWords(first, fields);
  const more = failing.length - 1;
  return more === 0 ? words : `${words}, and ${String(more)} more`;
}

/** Each operator's opposite, where the operators name one. */
const OPPOSITE: Readonly<Partial<Record<ConditionOp, ConditionOp>>> = {
  equals: "not_equals",
  not_equals: "equals",
  contains: "not_contains",
  not_contains: "contains",
  exists: "not_exists",
  not_exists: "exists",
  is_true: "is_false",
  is_false: "is_true",
};

/**
 * A condition that doesn't hold, said as what holds instead: its opposite
 * operator, worded as a row words it, or "isn't" before an order the
 * operators name no opposite for ("isn't more than 5").
 */
function oppositeWords(
  condition: Condition,
  fields: readonly ConditionField[]
): string {
  const draft = conditionDraftOf(condition);
  const field = fields.find(each => each.name === draft.field);
  const opposite = draft.op === undefined ? undefined : OPPOSITE[draft.op];
  if (opposite !== undefined) {
    return conditionLine(conditionSentence({ ...draft, op: opposite }, field));
  }
  const sentence = conditionSentence(draft, field);
  return conditionLine({
    ...sentence,
    operator: sentence.operator.replace(/^is /, "isn’t "),
  });
}
