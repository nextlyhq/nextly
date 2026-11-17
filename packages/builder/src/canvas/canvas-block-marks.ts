/**
 * The marks the canvas puts on drawn blocks, and what each block's mark is:
 * selected, locked, conditioned, Entry content, and during a drag the block
 * moving and the container a drop would land in or that refuses it. Each
 * answer is worked out once per document, and each mark is written only
 * when it changes.
 *
 * @module canvas-block-marks
 */

import {
  entryContentFieldOf,
  entryContentPlacements,
  isPlainRecord,
  placementGatesOf,
  revealConditioned,
  walkNodes,
  DEFAULT_LIMITS,
  resolveComponentInstances,
  type BlockDocument,
  type BlockNode,
  type DefinitionsById,
  type DocumentLimits,
} from "@nextlyhq/blocks-engine";
import { NODE_ID_ATTRIBUTE } from "@nextlyhq/blocks-react";

import type { AppliedConditions } from "../applied-conditions";
import {
  asStoredDefinitions,
  gatedAsDrawn,
  gatedAsStored,
} from "../condition-gate";
import { isLocked } from "../locking";
import {
  entryContentLabel,
  type PreviewedCollection,
} from "../previewed-entry";

import { isOutermostForAddress, nodeAddressOf } from "./canvas-addressing";
import { CANVAS_REGION_CLASS } from "./canvas-regions";

/**
 * Marks the selected block's own element.
 *
 * Boolean by presence rather than carrying the id: the element already states
 * its id through `NODE_ID_ATTRIBUTE`, and repeating it here would be a second
 * copy that a partial re-mark could leave disagreeing with the first.
 *
 * Exported because a host styling the canvas, and a test asserting what is
 * selected, both need to name it — and a string typed twice is a contract with
 * no compiler behind it.
 */
export const SELECTED_ATTRIBUTE = "data-nx-selected";

/**
 * Marks a node the drag engine will refuse to pick up.
 *
 * Drawn so the grab cursor can be withheld from it. With no drag handle, that
 * cursor is the only thing advertising a block as movable, so offering it on a
 * node `useCanvasDrag` returns early for leaves an author pressing repeatedly
 * at something that will never move — an affordance promising what the engine
 * has already decided against.
 */
export const LOCKED_ATTRIBUTE = "data-nx-locked";

/** How a block is locked in Layers: by its own lock, or by one around it. */
export type LockMark = "own" | "inherited";

/**
 * Every locked block's mark, from one walk: a block's own lock, else the lock
 * of a block it sits inside, carried down rather than climbed per block.
 */
export function lockMarksOf(document: BlockDocument): Map<string, LockMark> {
  const marks = new Map<string, LockMark>();
  walkNodes(document.nodes, (node, parent) => {
    if (isLocked(node)) marks.set(node.id, "own");
    else if (parent !== undefined && marks.has(parent.id)) {
      marks.set(node.id, "inherited");
    }
  });
  return marks;
}

/**
 * Marks a block whose visibility conditions decide who sees it. The canvas
 * draws it whoever the page would show it to, so the author can see and
 * select it, and this says it isn't shown to everyone: `conditional`, or
 * `unchecked` for one whose conditions the page can't check, which visitors
 * never see.
 */
export const CONDITIONED_ATTRIBUTE = "data-nx-conditioned";

/**
 * Marks an element whose condition mark is its own block's, a block of a
 * placed component's definition, rather than its placement's: the marks
 * badge each such block apart, where a placement's roots share one badge.
 * Its value names the placement nested in a component whose gate the block
 * carries, when that gate is all it carries, so that placement's roots share
 * one badge too; empty for a block's own conditions.
 */
export const CONDITIONED_OWN_ATTRIBUTE = "data-nx-conditioned-own";

/**
 * How a conditioned block is marked on the canvas: conditional, or conditions
 * the page can't check, or, while conditions are applied, shown for the
 * previewed entry.
 */
type ConditionMark = "conditional" | "unchecked" | "shown";

/**
 * Every conditioned block's mark, and for a composed block gated only by a
 * placement nested in a component, which placement: the badge its roots
 * share.
 */
export interface ConditionMarks {
  readonly marks: ReadonlyMap<string, ConditionMark>;
  readonly nested: ReadonlyMap<string, string>;
}

/**
 * Every conditioned block's mark, from one walk, asked of the engine's own
 * gate so the canvas marks exactly the blocks the page judges. `unchecked`
 * names the blocks whose conditions the page can't check, which only a host
 * knowing the collections' fields can say.
 */
export function conditionMarksOf(
  document: BlockDocument,
  unchecked: ReadonlySet<string> | undefined,
  composed: { definitions?: DefinitionsById; limits?: DocumentLimits },
  applied?: AppliedConditions
): ConditionMarks {
  const marks = new Map<string, ConditionMark>();
  const nested = new Map<string, string>();
  const markIf = (node: BlockNode, gated: boolean): void => {
    if (marks.has(node.id) || !gated) return;
    marks.set(
      node.id,
      unchecked?.has(node.id) === true ? "unchecked" : "conditional"
    );
  };
  const bound = {
    maxNodes: composed.limits?.maxNodes ?? DEFAULT_LIMITS.maxNodes,
  };
  // The page's own blocks, a placement among them, by their ids, which are
  // the addresses the canvas draws them with.
  walkNodes(document.nodes, node => markIf(node, gatedAsStored(node)), bound);
  // And the blocks a placed component's definition holds, by the ids the
  // composed tree gives them, which the canvas draws them with: composed as
  // the renderer composes, each conditioned placement expanded too. The
  // page's own conditions are lifted first, as the canvas draws the page, so
  // what a composed block carries is its definition's: its own conditions,
  // and the gates of the placements nested inside a component that were
  // expanded into it, which only the composed tree still holds.
  if (composed.definitions !== undefined && composed.definitions.size > 0) {
    // Under the limits the canvas renders with, so a page the site allows
    // past the default is composed here as it is drawn, from the definitions
    // as the renderer reads them.
    const tree = resolveComponentInstances(
      revealConditioned(document),
      asStoredDefinitions(composed.definitions, composed.limits),
      {
        conditioned: "carry",
        ...(composed.limits === undefined ? {} : { limits: composed.limits }),
      }
    ).document;
    const placements = new Map<string, string>();
    walkNodes(
      tree.nodes,
      node => {
        markIf(node, gatedAsDrawn(node));
        const placement = nestedPlacementOf(node);
        if (placement === undefined) return;
        // The innermost placement's gate is the first a root carries, the
        // same for each of its roots, so they share one badge.
        let group = placements.get(placement);
        if (group === undefined) {
          group = `p${String(placements.size + 1)}`;
          placements.set(placement, group);
        }
        nested.set(node.id, group);
      },
      bound
    );
  }
  // While conditions are applied, a judged block a visitor would see says so,
  // and one they would not is drawn as its marker, which says so itself.
  if (applied !== undefined) {
    for (const id of applied.shown) marks.set(id, "shown");
    for (const block of applied.hidden) marks.delete(block.id);
  }
  return { marks, nested };
}

/**
 * The gate of the innermost placement nested in a component that a composed
 * block is a root of, as text, when that gate, and not conditions of its own,
 * is what gates it.
 */
function nestedPlacementOf(node: BlockNode): string | undefined {
  if (gatedAsStored(node) || !isPlainRecord(node.visibility)) return undefined;
  const gates = placementGatesOf(node.visibility);
  return gates.length === 0 ? undefined : JSON.stringify(gates[0]);
}

/**
 * Marks an Entry content block, with the words its at-rest mark's tab reads:
 * "Entry content · Body". The block draws the entry's own content rather
 * than the template's, which is edited on the entry, so the canvas says so
 * whether or not it is selected.
 */
export const ENTRY_CONTENT_ATTRIBUTE = "data-nx-entry-content";

/**
 * Every Entry content block's words, by its id, from one walk: the field it
 * draws named as the template's collection names it.
 */
export function entryContentMarksOf(
  document: BlockDocument,
  collection: PreviewedCollection | undefined,
  maxNodes: number | undefined
): Map<string, string> {
  const marks = new Map<string, string>();
  for (const { node } of entryContentPlacements(
    document.nodes,
    maxNodes ?? DEFAULT_LIMITS.maxNodes
  )) {
    marks.set(
      node.id,
      entryContentLabel(entryContentFieldOf(node), collection)
    );
  }
  return marks;
}

/**
 * The words an Entry content block's outermost element carries, by its
 * address. Never inside a Layout region, a document of its own whose ids
 * may repeat the page's.
 */
export function entryContentMarkFor(
  element: Element,
  container: HTMLElement,
  marks: ReadonlyMap<string, string>
): string | undefined {
  if (marks.size === 0) return undefined;
  const address = nodeAddressOf(element);
  if (address === null) return undefined;
  if (element.closest(`.${CANVAS_REGION_CLASS}`) !== null) return undefined;
  return isOutermostForAddress(element, address, container)
    ? marks.get(address)
    : undefined;
}

/**
 * The mark a drawn element carries: a definition's own conditioned block by
 * its composed id, else the block or placement it is the outermost element
 * of, by its address. Never inside a Layout region, a document of its own
 * whose ids may repeat the page's.
 */
export function conditionMarkFor(
  element: Element,
  container: HTMLElement,
  { marks, nested }: ConditionMarks
): { mark: ConditionMark; own: boolean; nested?: string } | undefined {
  const address = nodeAddressOf(element);
  if (address === null) return undefined;
  if (element.closest(`.${CANVAS_REGION_CLASS}`) !== null) return undefined;
  const id = element.getAttribute(NODE_ID_ATTRIBUTE);
  const own = id !== null && id !== address ? marks.get(id) : undefined;
  const placed = isOutermostForAddress(element, address, container)
    ? marks.get(address)
    : undefined;
  if (own === undefined) {
    return placed === undefined ? undefined : { mark: placed, own: false };
  }
  // A block with conditions of its own that is also the root of a
  // conditioned placement is drawn only when both hold, so its one badge says
  // "Can't be checked" when either can't be.
  const placement = id === null ? undefined : nested.get(id);
  return {
    mark: placed === "unchecked" ? "unchecked" : own,
    own: true,
    ...(placement === undefined ? {} : { nested: placement }),
  };
}

/**
 * Marks every element drawing the block currently being dragged.
 *
 * EVERY element rather than one: a node id is unique in a document and not in
 * the tree drawn from it, so a repeating block is many elements for one id and
 * a mark that stopped at the first would dim one copy of a block that is
 * wholly in flight.
 *
 * Boolean by presence, for the reason {@link SELECTED_ATTRIBUTE} is: the
 * element already states its id.
 */
export const DRAG_SOURCE_ATTRIBUTE = "data-nx-drag-source";

/**
 * Marks the container a drop would land in.
 *
 * The line says WHERE among siblings; this says WHICH container, and the two
 * are different questions. They come apart exactly where the line alone is
 * ambiguous — the coordinate at the bottom edge of one container is also the
 * top edge of the next, and only this mark separates them.
 */
export const DROP_PARENT_ATTRIBUTE = "data-nx-drop-parent";

/**
 * Marks the container that will not take the block being dragged.
 *
 * Mutually exclusive with {@link DROP_PARENT_ATTRIBUTE} by construction: the
 * engine answers with a target or a refusal, never both, so an element carrying
 * the two at once is drawing a state that cannot exist.
 */
export const DROP_REFUSED_ATTRIBUTE = "data-nx-drop-refused";

/**
 * Add or remove a boolean attribute, writing only when the answer changes.
 *
 * The comparison is the point rather than a saving. `setAttribute` queues a
 * mutation record even when the value it writes is the value already there,
 * the empty-container appender observes this subtree, and a drag re-marks on
 * every pointer move — so an unguarded write is a re-measure per frame rather
 * than one per drop.
 *
 * One function rather than the same three lines at each mark: they are one
 * rule, and four copies of it are four chances for the guard to be dropped
 * from whichever copy is edited next.
 */
export function setFlag(
  element: Element,
  attribute: string,
  wanted: boolean
): void {
  if (wanted === element.hasAttribute(attribute)) return;
  if (wanted) element.setAttribute(attribute, "");
  else element.removeAttribute(attribute);
}

/**
 * Set an attribute to a value, or remove it for `undefined`, writing only when
 * it changes, for the reason {@link setFlag} gives.
 */
export function setMark(
  element: Element,
  attribute: string,
  value: string | undefined
): void {
  if (element.getAttribute(attribute) === (value ?? null)) return;
  if (value === undefined) element.removeAttribute(attribute);
  else element.setAttribute(attribute, value);
}
