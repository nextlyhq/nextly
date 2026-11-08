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
  CONDITION_HIDDEN_TYPE,
  conditionScopeIn,
  DEFAULT_LIMITS,
  evaluateConditions,
  isPlainRecord,
  mapForest,
  resolveComponentInstances,
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
  type DefinitionsById,
  type BindingFieldShape,
  type DocumentLimits,
  type NodeVisibility,
  type ResolvedBlockNode,
} from "@nextlyhq/blocks-engine";
import {
  liftedNode,
  prepareDocumentAsDrawn,
  registeredBlocks,
  sanitizeDocument,
  type EntryJudgement,
  type HidingItem,
  type ItemHiddenAs,
} from "@nextlyhq/blocks-react";

import { storedGroups } from "./condition-checks";
import { asStoredDefinitions, gatedAsStored } from "./condition-gate";
import {
  conditionDraftOf,
  conditionLine,
  conditionFieldsOfShapes,
  conditionSentence,
  type ConditionField,
} from "./condition-model";

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
  /**
   * Whether the page holds a conditioned block left unjudged, so what is said
   * of the judged blocks is not said of all: one a list's item decides, where
   * the lists do not draw what a visitor reads, or one in a region of the
   * page's Layout.
   */
  readonly unjudged: boolean;
  /**
   * Whether the page holds conditioned blocks judged for each list entry
   * drawn, by the renderer, which `shown` and `hidden` do not count: each
   * one an entry hides is drawn as its marker in that entry.
   */
  readonly byEntry: boolean;
  /**
   * How the canvas's renderer judges the blocks of the components the page
   * places, for the previewed entry, as the page's route judges them: each
   * one they hide drawn as its marker, keeping the placement it belongs to.
   * The page's own blocks are judged in `document` already.
   */
  readonly entryJudgement: EntryJudgement;
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
  nameOf: (node: BlockNode) => string,
  drawn: DrawnWith = {}
): AppliedConditions {
  const { shown, hidden, markers, itemGated, unjudged } = judgedBlocks(
    document,
    preview,
    nameOf,
    drawn
  );
  // A hidden block becomes its marker: matched by its id AND its stored
  // conditions, so a duplicate id elsewhere (stored data may hold one) with
  // conditions of its own, or none, is drawn as itself.
  const marked =
    markers.size === 0
      ? document
      : {
          ...document,
          nodes: mapForest(document.nodes, node => {
            const block = gatedAsStored(node)
              ? markers.get(occurrenceKey(node))
              : undefined;
            return block === undefined ? node : markerFor(block, node);
          }),
        };
  // Every other conditioned block is drawn, as the canvas draws them while
  // conditions are not applied; but one a list's item decides, where the
  // lists draw what a visitor reads, keeps its conditions for the renderer
  // to judge against each item.
  const applied =
    itemGated.size === 0
      ? revealConditioned(marked)
      : liftedExcept(marked, itemGated);
  // The blocks of the components the page places, judged on the page as the
  // canvas draws it, so a placement the page's own judgement already hid or
  // showed is judged once.
  const components = judgedComponentBlocks(applied, preview, nameOf, drawn);
  return {
    document: applied,
    shown: new Set([...shown, ...components.shown]),
    hidden: [...hidden, ...components.hidden],
    unjudged: unjudged || drawsUnjudged(drawn),
    byEntry: itemGated.size > 0 || components.byEntry,
    entryJudgement: entryJudgementOf(preview, nameOf, components.hidden),
  };
}

/** The blocks of the components a page places, judged for the entry. */
interface JudgedComponents {
  readonly shown: ReadonlySet<string>;
  readonly hidden: readonly HiddenBlock[];
  /** Whether a placed component's block is left for a list's item. */
  readonly byEntry: boolean;
}

/**
 * The blocks of the components `page` places, judged for the previewed
 * entry by the renderer's own preparation (`prepareDocumentAsDrawn` with an
 * entry judgement), each by the id it is drawn under: the very judgement the
 * canvas's renderer makes, and the page's route makes.
 */
function judgedComponentBlocks(
  page: BlockDocument,
  preview: ConditionsPreview,
  nameOf: (node: BlockNode) => string,
  drawn: DrawnWith
): JudgedComponents {
  const shown = new Set<string>();
  const hidden: HiddenBlock[] = [];
  if (drawn.definitions === undefined || drawn.definitions.size === 0) {
    return { shown, hidden, byEntry: false };
  }
  const prepared = prepareDocumentAsDrawn(page, {
    resolver: registeredBlocks(),
    definitions: drawn.definitions,
    ...(drawn.limits === undefined ? {} : { limits: drawn.limits }),
    entryJudged: {
      ...gateOf(preview),
      hiddenAs: node => {
        hidden.push(hiddenBlockOf(node, preview, nameOf));
        return undefined;
      },
      onJudged: (id, isShown) => {
        if (isShown) shown.add(id);
      },
    },
  });
  return {
    shown,
    hidden,
    // What is left gated is what a list's item decides.
    byEntry:
      prepared !== null &&
      conditionedBlocksIn(prepared, drawn.limits).readingItems,
  };
}

/** The route's gate for the previewed entry. */
function gateOf(
  preview: ConditionsPreview
): Pick<EntryJudgement, "entry" | "dayStart"> {
  return {
    ...(preview.subject === undefined ? {} : { entry: preview.subject }),
    ...(preview.dayStart === undefined ? {} : { dayStart: preview.dayStart }),
  };
}

/** A block the entry hides, with what its marker says: its name and why. */
function hiddenBlockOf(
  node: BlockNode,
  preview: ConditionsPreview,
  nameOf: (node: BlockNode) => string
): HiddenBlock {
  // The whole node, as the renderer judged it, the gates of the placements
  // it was expanded from among its conditions.
  const verdict = evaluateConditions(node, inputOf(preview));
  return {
    id: node.id,
    name: nameOf(node),
    ...reasonOf(node, verdict, preview),
  };
}

/**
 * How the canvas's renderer judges the page's components for the entry:
 * each block they hide drawn as its marker, worded as `hidden` words it, and
 * keeping the placement it belongs to, so a press on it selects that.
 */
function entryJudgementOf(
  preview: ConditionsPreview,
  nameOf: (node: BlockNode) => string,
  hidden: readonly HiddenBlock[]
): EntryJudgement {
  const byId = new Map(hidden.map(block => [block.id, block]));
  return {
    ...gateOf(preview),
    hiddenAs: node => {
      const block = byId.get(node.id) ?? hiddenBlockOf(node, preview, nameOf);
      const placement = (node as ResolvedBlockNode).instanceOf;
      const marker: ResolvedBlockNode = markerFor(block, node);
      return placement === undefined
        ? marker
        : { ...marker, instanceOf: placement };
    },
  };
}

/**
 * What else the canvas draws the page with, whose conditioned blocks are not
 * judged here: the definitions of the components it places, and the regions
 * of its Layout.
 */
export interface DrawnWith {
  /** The limits the canvas draws under, so every block it draws is judged. */
  readonly limits?: DocumentLimits;
  /**
   * Whether the canvas's lists draw the entries a visitor reads, so a block a
   * list's item decides is judged for each item drawn, by the renderer, and
   * keeps its conditions in the page drawn rather than being shown for every
   * item. Otherwise such a block is left unjudged, drawn for every item.
   */
  readonly itemsJudged?: boolean;
  /** The definitions of the components the page places. */
  readonly definitions?: DefinitionsById;
  /** The regions of the page's Layout, drawn around it, each with its own definitions. */
  readonly regions?: readonly {
    readonly document: BlockDocument;
    readonly definitions?: DefinitionsById;
  }[];
}

/**
 * Whether the canvas draws a conditioned block this does not judge: anything
 * conditioned in a region of the page's Layout, its own or its components'.
 */
function drawsUnjudged(drawn: DrawnWith): boolean {
  return (drawn.regions ?? []).some(
    region =>
      conditionedBlocksIn(region.document, drawn.limits).any ||
      reachesConditioned(region.document, region.definitions, drawn.limits)
  );
}

/**
 * Whether a document reaches a component holding a conditioned block, as the
 * resolver reaches them: through each placement, the components they place,
 * and whichever a variant or an override selects.
 */
function reachesConditioned(
  document: BlockDocument,
  definitions: DefinitionsById | undefined,
  limits: DocumentLimits | undefined
): boolean {
  if (definitions === undefined || definitions.size === 0) return false;
  const { referenced } = resolveComponentInstances(document, definitions, {
    conditioned: "carry",
    ...(limits === undefined ? {} : { limits }),
  });
  return referenced.some(id => {
    const definition = definitions.get(id);
    return (
      definition !== undefined && conditionedBlocksIn(definition, limits).any
    );
  });
}

/** One occurrence of a conditioned block: its id and its stored conditions. */
function occurrenceKey(node: BlockNode): string {
  return `${node.id}\0${JSON.stringify(storedVisibilityOf(node.visibility) ?? null)}`;
}

/**
 * A hidden block's marker, keeping its id so the canvas selects the block,
 * and what is left of its visibility once its conditions are lifted: the
 * devices it is hidden on, which the marker is hidden on too, as the block
 * would be whatever its conditions said.
 */
function markerFor(block: HiddenBlock, stored: BlockNode): BlockNode {
  const props: ConditionHiddenProps = {
    name: block.name,
    reason: block.reason,
    unchecked: block.unchecked,
  };
  // Its conditions lifted as the canvas lifts them, keeping its devices.
  const devices = liftedNode(stored).visibility;
  return {
    id: block.id,
    type: CONDITION_HIDDEN_TYPE,
    version: 1,
    props,
    ...(devices === undefined ? {} : { visibility: devices }),
  };
}

/**
 * What the canvas reads to say why a list's item hides a block: the fields a
 * visitor may read of a collection's entries, the same fields as the "Show
 * when" rows name them where the host lists them, each block's name, and
 * where the site's days start.
 *
 * @experimental Settles with the editor's condition controls.
 */
export interface ItemMarkerSources {
  readonly fieldsOf: (
    collection: string
  ) => readonly BindingFieldShape[] | undefined;
  readonly labelledOf?: (
    collection: string
  ) => readonly ConditionField[] | undefined;
  readonly nameOf: (node: BlockNode) => string;
  readonly dayStart?: ConditionDayStart;
}

/**
 * What the canvas draws where a list's item hides a block, while conditions
 * apply: the block's marker, saying why this entry hides it, as a hidden
 * block of the page itself says it. Judged against the item as the published
 * page judges it; an item whose fields are not known, a named query's row
 * among them, fails closed there, so its marker says the block can't be
 * checked.
 *
 * @experimental Settles with the editor's condition controls.
 */
export function itemHiddenAsOf(sources: ItemMarkerSources): ItemHiddenAs {
  return (node, item) => {
    const preview = itemPreviewOf(sources, item);
    // The whole node, as the renderer judged it: its own conditions and the
    // gates of a placement it was expanded from (`within`), which hide a
    // component's otherwise unconditioned root.
    const verdict = evaluateConditions(node, inputOf(preview));
    // The renderer asks only about a block the item hides; a verdict that
    // says otherwise draws the block's place empty rather than a false mark.
    if (verdict.shown) return undefined;
    return markerFor(
      {
        id: node.id,
        name: sources.nameOf(node),
        ...reasonOf(node, verdict, preview),
      },
      node
    );
  };
}

/**
 * The list item as a visitor reads it: its values, and the fields its
 * conditions were judged by as the renderer handed them, a named query's own
 * row schema among them; where it handed none, the fields a visitor may read
 * of its collection's entries, and none where those are not known either.
 */
function itemPreviewOf(
  sources: ItemMarkerSources,
  item: HidingItem
): ConditionsPreview {
  const { collection } = item;
  const known =
    collection === undefined
      ? {}
      : {
          readable: sources.fieldsOf(collection),
          labelled: sources.labelledOf?.(collection),
        };
  const readable = item.fields ?? known.readable ?? [];
  return {
    subject: {
      fields: {
        declared: new Set(readable.map(field => field.name)),
        readable,
      },
      values: item.values,
    },
    noun: "entry",
    fields: known.labelled ?? conditionFieldsOfShapes(readable),
    ...(sources.dayStart === undefined ? {} : { dayStart: sources.dayStart }),
  };
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
  nameOf: (node: BlockNode) => string,
  drawn: Pick<DrawnWith, "limits" | "itemsJudged">
): {
  shown: Set<string>;
  hidden: HiddenBlock[];
  markers: Map<string, HiddenBlock>;
  /** The blocks a list's item decides, by occurrence, when items are judged. */
  itemGated: Set<string>;
  unjudged: boolean;
} {
  const shown = new Set<string>();
  const hidden: HiddenBlock[] = [];
  const markers = new Map<string, HiddenBlock>();
  const itemGated = new Set<string>();
  let unjudged = false;
  walkScoped(document, drawn.limits, (block, scope) => {
    if (!gatedAsStored(block)) return true;
    if (scope.source !== "entry") {
      if (drawn.itemsJudged === true) itemGated.add(occurrenceKey(block));
      else unjudged = true;
      return true;
    }
    const verdict = evaluateConditions(storedGate(block), inputOf(preview));
    if (verdict.shown) {
      shown.add(block.id);
      return true;
    }
    const judged: HiddenBlock = {
      id: block.id,
      name: nameOf(block),
      ...reasonOf(block, verdict, preview),
    };
    hidden.push(judged);
    markers.set(occurrenceKey(block), judged);
    return false;
  });
  return { shown, hidden, markers, itemGated, unjudged };
}

/**
 * The page as the canvas draws it: every conditioned block drawn, its
 * conditions lifted, but, while a list's entries are judged (`byEntry`),
 * a block a list's entry decides, which keeps its conditions for the
 * renderer to judge against each entry drawn.
 *
 * @experimental Settles with the editor's condition controls.
 */
export function revealedForCanvas(
  document: BlockDocument,
  applied: Pick<AppliedConditions, "byEntry"> | undefined,
  limits?: DocumentLimits
): BlockDocument {
  if (applied?.byEntry !== true) return revealConditioned(document);
  const kept = new Set<string>();
  walkScoped(document, limits, (block, scope) => {
    if (gatedAsStored(block) && scope.source !== "entry") {
      kept.add(occurrenceKey(block));
    }
    return true;
  });
  return kept.size === 0
    ? revealConditioned(document)
    : liftedExcept(document, kept);
}

/**
 * The page with every block's conditions lifted but those of `kept`, by
 * occurrence, which the renderer judges for each list item it draws.
 */
function liftedExcept(
  document: BlockDocument,
  kept: ReadonlySet<string>
): BlockDocument {
  return {
    ...document,
    nodes: mapForest(document.nodes, node =>
      gatedAsStored(node) && kept.has(occurrenceKey(node))
        ? node
        : liftedNode(node)
    ),
  };
}

/**
 * Which conditioned blocks a document holds: any at all, and any that reads
 * the entry it is drawn for, which is what applying conditions judges. With
 * `definitions`, the blocks of the components it places too, read as the
 * resolver composes them, each in the scope it is drawn in.
 *
 * @experimental Settles with the editor's condition controls.
 */
export function conditionedBlocksIn(
  document: BlockDocument,
  limits?: DocumentLimits,
  definitions?: DefinitionsById
): {
  readonly any: boolean;
  readonly readingEntry: boolean;
  /** Whether any is in a list's per-entry slot, read against each item. */
  readonly readingItems: boolean;
} {
  let any = false;
  let readingEntry = false;
  let readingItems = false;
  const read =
    definitions === undefined || definitions.size === 0
      ? document
      : resolveComponentInstances(
          document,
          asStoredDefinitions(definitions, limits),
          { conditioned: "carry", ...(limits === undefined ? {} : { limits }) }
        ).document;
  walkScoped(read, limits, (block, scope) => {
    if (gatedAsStored(block)) {
      any = true;
      readingEntry ||= scope.source === "entry";
      readingItems ||= scope.source !== "entry";
    }
    return !(readingEntry && readingItems);
  });
  return { any, readingEntry, readingItems };
}

/**
 * Every block of a document, in page order, with what its conditions read:
 * the entry, or a list's item inside its per-entry slot (`conditionScopeIn`,
 * the save's and the renderer's one rule). `visit` answers whether to go on
 * into the block's own blocks.
 *
 * Walked over the document as the renderer makes it sound to draw
 * (`sanitizeDocument`), under the limits the canvas draws with: a node the
 * renderer drops (no type, an impossible version) or never reaches (past the
 * node limit) is never judged, so applying conditions never draws a marker
 * for a block the canvas would not draw.
 */
function walkScoped(
  document: BlockDocument,
  limits: DocumentLimits | undefined,
  visit: (block: BlockNode, scope: ConditionScope) => boolean
): void {
  const sound = sanitizeDocument(document, limits ?? DEFAULT_LIMITS);
  const roots: unknown[] = sound.nodes;
  const stack: Visit[] = roots
    .map(node => ({ node, scope: ENTRY_SCOPE }))
    .reverse();
  // The sanitized tree already holds no more than the limit; bounded again
  // because the walk is the one that would loop on a tree that did.
  let left = (limits ?? DEFAULT_LIMITS).maxNodes;
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
  // First: with no entry a visitor reads, the engine reports its source as
  // unavailable, which is no fault of the conditions themselves.
  if (preview.subject === undefined) {
    return {
      reason: `hidden: this ${preview.noun} isn’t published yet`,
      unchecked: false,
    };
  }
  if (verdict.issues.length > 0) {
    return {
      reason: "can’t be checked, so visitors never see it",
      unchecked: true,
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
