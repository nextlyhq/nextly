/**
 * What "the selection" is once it can hold more than one block.
 *
 * A page builder that can only ever act on one block makes every repetitive
 * job — deleting six cards, locking a whole section's children, moving a run of
 * blocks — a sequence of identical single edits. This module is the grammar for
 * the alternative, decided without a DOM.
 *
 * ## A SET plus a PRIMARY, not a set alone
 *
 * The selection is an ordered set of ids AND one primary id. The primary is the
 * block the inspector edits, the block the breadcrumb traces, and the anchor a
 * range extends from. Modelling the set alone would leave every one of those
 * surfaces inventing "which of these did the author mean" separately, and they
 * would each pick a different answer — the first in document order, the last
 * clicked, the deepest. It is also what lets the existing single-selection
 * surfaces keep working unchanged: `primary` IS the old `selectedId`, with a
 * name that says what it means.
 *
 * ## Document order, always
 *
 * The set is kept in document order rather than click order. Every consumer
 * that acts on a selection — delete, duplicate, an announcement counting what
 * is in it — either needs that order or is indifferent to it, and a set that
 * remembered clicks would make "delete the selection" produce a different
 * document depending on which block the author happened to click first.
 *
 * ## Outermost only
 *
 * A selection holding a container AND something inside it is normalised to the
 * container. This is not tidiness: deleting such a set would remove the child
 * twice, the second time from a document that no longer has it, and duplicating
 * it would produce the child both inside the copied container and beside it.
 * The engine already reads nesting this way — `lockBlockingDelete` walks
 * outermost-first for the same reason.
 *
 * ## The three gestures, which are the platform's and not ours
 *
 * Plain click REPLACES, `mod`-click TOGGLES, shift-click EXTENDS. That is the
 * grammar of every file manager, every list view and every design tool people
 * arrive already knowing, and inventing a fourth would be a thing to teach for
 * no gain.
 *
 * @module selection
 */

import { type BlockDocument, type BlockNode } from "@nextlyhq/blocks-engine";

/** How a gesture changes the selection. */
export type SelectionMode = "replace" | "toggle" | "extend";

/** The selection: what is in it, and which one the surfaces answer for. */
export interface Selection {
  /** Every selected id, in document order, outermost only. */
  readonly ids: readonly string[];
  /**
   * The block the inspector edits and a range extends from, or `null`.
   *
   * Always a member of `ids` when `ids` is non-empty, which callers may rely
   * on: a primary outside the set would make the inspector edit a block the
   * canvas does not show as selected.
   */
  readonly primary: string | null;
}

/** Nothing selected. */
export const EMPTY_SELECTION: Selection = { ids: [], primary: null };

/**
 * Every id in the document, in the order a reader meets them.
 *
 * Deliberately a walk of its own rather than a flatten of `layersOf`, which
 * would compute a label, a lock badge and two style predicates per node on
 * every click. `selection.test` asserts this agrees with `layersOf`'s order, so
 * there is one VERIFIED definition of document order rather than one shared
 * implementation of it.
 */
export function documentOrder(document: BlockDocument): string[] {
  const out: string[] = [];
  const walk = (nodes: readonly BlockNode[]): void => {
    for (const node of nodes) {
      out.push(node.id);
      for (const children of Object.values(node.slots ?? {})) walk(children);
    }
  };
  walk(document.nodes);
  return out;
}

/** The ids from the root down to `id`, inclusive, or `[]` when it is absent. */
function pathOf(document: BlockDocument, id: string): string[] {
  const find = (nodes: readonly BlockNode[], trail: string[]): string[] => {
    for (const node of nodes) {
      const here = [...trail, node.id];
      if (node.id === id) return here;
      for (const children of Object.values(node.slots ?? {})) {
        const found = find(children, here);
        if (found.length > 0) return found;
      }
    }
    return [];
  };
  return find(document.nodes, []);
}

/**
 * The set with anything that has an ancestor in it removed, in document order.
 *
 * Ids the document no longer holds are dropped too, which an undo produces
 * routinely — a selection outliving its blocks is the normal case, not an edge
 * one.
 */
export function normalizeSelection(
  document: BlockDocument,
  ids: readonly string[]
): string[] {
  const paths = new Map<string, string[]>();
  for (const id of ids) {
    const path = pathOf(document, id);
    if (path.length > 0) paths.set(id, path);
  }

  const kept = [...paths.keys()].filter(id => {
    const path = paths.get(id) ?? [];
    // Every entry but the last is an ancestor. If the set holds one of them,
    // this node travels with it and listing it as well would act on it twice.
    return !path.slice(0, -1).some(ancestor => paths.has(ancestor));
  });

  const order = documentOrder(document);
  return kept.sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

/**
 * The sibling run between two blocks, at the deepest level they share.
 *
 * Shift-clicking a block inside another section does NOT select across the two
 * containers, because there is no run of siblings spanning them. It selects the
 * run at the level where the two paths diverge — the sections themselves — so
 * the gesture always answers with something contiguous.
 *
 * `[]` when either id is absent, and the OUTER one alone when one contains the
 * other: a range from a container to something inside it is the container.
 */
export function rangeBetween(
  document: BlockDocument,
  anchorId: string,
  targetId: string
): string[] {
  const anchor = pathOf(document, anchorId);
  const target = pathOf(document, targetId);
  if (anchor.length === 0 || target.length === 0) return [];

  let shared = 0;
  while (
    shared < anchor.length &&
    shared < target.length &&
    anchor[shared] === target[shared]
  ) {
    shared += 1;
  }

  // One is on the other's path, so they are not siblings at any level.
  if (shared === anchor.length) return [anchorId];
  if (shared === target.length) return [targetId];

  const from = anchor[shared];
  const to = target[shared];
  if (from === undefined || to === undefined) return [];

  const parentId = shared === 0 ? undefined : anchor[shared - 1];
  const siblings = siblingRunOf(document, parentId, from, to);
  return siblings;
}

/** The contiguous run of siblings from `from` to `to`, whichever comes first. */
function siblingRunOf(
  document: BlockDocument,
  parentId: string | undefined,
  from: string,
  to: string
): string[] {
  const lists =
    parentId === undefined ? [document.nodes] : slotListsOf(document, parentId);

  for (const list of lists) {
    const ids = list.map(node => node.id);
    const a = ids.indexOf(from);
    const b = ids.indexOf(to);
    // BOTH in the same list. A parent's slots are separate lists, and a run
    // spanning two of them is not contiguous however close the indices look.
    if (a === -1 || b === -1) continue;
    return ids.slice(Math.min(a, b), Math.max(a, b) + 1);
  }
  return [];
}

/** Each of a parent's slots, as its own list. */
function slotListsOf(document: BlockDocument, parentId: string): BlockNode[][] {
  const find = (nodes: readonly BlockNode[]): BlockNode[][] | undefined => {
    for (const node of nodes) {
      if (node.id === parentId) return Object.values(node.slots ?? {});
      for (const children of Object.values(node.slots ?? {})) {
        const found = find(children);
        if (found !== undefined) return found;
      }
    }
    return undefined;
  };
  return find(document.nodes) ?? [];
}

/**
 * The selection after a gesture on `targetId`.
 *
 * `null` clears it, whatever the mode: a click on canvas background has no
 * subject to toggle or extend to.
 */
/**
 * The selection with `id` in it, or out of it if it was already there.
 *
 * Adding makes the NEW block primary: it is the one the author just pointed at
 * and the one they expect the inspector to describe. Removing keeps whatever
 * primary the selection had, which {@link withPrimary} corrects when the block
 * removed WAS the primary.
 */
function toggled(
  document: BlockDocument,
  current: Selection,
  targetId: string
): Selection {
  const has = current.ids.includes(targetId);
  const ids = normalizeSelection(
    document,
    has ? current.ids.filter(id => id !== targetId) : [...current.ids, targetId]
  );
  return withPrimary(ids, has ? current.primary : targetId);
}

/**
 * The run from the selection's anchor to `targetId`.
 *
 * The run REPLACES rather than unions with what was selected. Shift-click in
 * every list this grammar comes from means "the selection is now
 * anchor-to-here", and unioning would make a second shift-click GROW the
 * selection instead of redefining it — so an author correcting their aim would
 * have to clear and start again.
 *
 * The anchor stays primary, which is what makes a run of shift-clicks re-aim
 * from the same end rather than walking the anchor along.
 */
function extended(
  document: BlockDocument,
  current: Selection,
  targetId: string
): Selection {
  if (current.primary === null) return replaced(targetId);
  const run = rangeBetween(document, current.primary, targetId);
  // No contiguous run reaches the target — across two slots of one parent, for
  // instance. Selecting the target alone is right; emptying the selection would
  // read as the gesture being broken.
  if (run.length === 0) return replaced(targetId);
  return withPrimary(normalizeSelection(document, run), current.primary);
}

/** One block, selected on its own. */
function replaced(targetId: string): Selection {
  return { ids: [targetId], primary: targetId };
}

/**
 * A selection whose primary is guaranteed to be a member of it.
 *
 * The one place that invariant is enforced, so no caller has to remember it. A
 * primary outside the set would make the inspector edit a block the canvas does
 * not show as selected.
 *
 * Falls back to the FIRST id in document order, deliberately: that is a
 * position the author can see, where "the one next to what you just removed" is
 * a rule they would have to be told. An earlier version chose the last survivor
 * and no test could tell the two apart, which is how the arbitrariness was
 * found.
 */
function withPrimary(
  ids: readonly string[],
  preferred: string | null
): Selection {
  if (ids.length === 0) return EMPTY_SELECTION;
  return {
    ids,
    primary: preferred !== null && ids.includes(preferred) ? preferred : ids[0],
  };
}

/**
 * The selection after a gesture on `targetId`.
 *
 * `null` clears it, whatever the mode: a click on canvas background has no
 * subject to toggle or extend to. A target the document does not hold is
 * IGNORED rather than treated as a deselect — a stale id is not an instruction
 * to clear, and treating it as one loses a selection for a reason the author
 * cannot see.
 *
 * A dispatcher and nothing else. Each mode is its own function above, because
 * the three were one body until a complexity gate objected — and it was right:
 * the shared shape between them is only "normalise, then pick a primary", which
 * {@link withPrimary} now owns for all three.
 */
export function applySelection(
  document: BlockDocument,
  current: Selection,
  targetId: string | null,
  mode: SelectionMode = "replace"
): Selection {
  if (targetId === null) return EMPTY_SELECTION;
  if (pathOf(document, targetId).length === 0) return current;

  if (mode === "toggle") return toggled(document, current, targetId);
  if (mode === "extend") return extended(document, current, targetId);
  return replaced(targetId);
}

/**
 * The selection with anything the document has lost dropped.
 *
 * Called after an edit rather than on read, so a surface never renders against
 * ids that are gone. An undo removing selected blocks is routine.
 */
export function pruneSelection(
  document: BlockDocument,
  selection: Selection
): Selection {
  const ids = normalizeSelection(document, selection.ids);
  if (ids.length === 0) return EMPTY_SELECTION;
  const primary =
    selection.primary !== null && ids.includes(selection.primary)
      ? selection.primary
      : (ids[0] ?? null);
  return { ids, primary };
}
