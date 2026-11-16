/**
 * Where an insert could land around the selected block: the candidates inside
 * it and after it, and the position each one inserts at.
 *
 * @module insertion-candidates
 */

import {
  findNode,
  locateNode,
  type BlockDocument,
  type PlacementTarget,
} from "@nextlyhq/blocks-engine";

import { emptySlotOf } from "./empty-slot";
import type { SlotSource } from "./inserter-types";
import { positionOf, type OpPosition } from "./op-vocabulary";

/**
 * One place a click in the Add panel may put a block, and what it goes after.
 *
 * `afterId` names the block the new one follows ("Adding after Heading"), and
 * is absent at the end of the page and inside a container.
 */
export interface InsertionCandidate {
  readonly kind:
    | "after-selection"
    | "after-ancestor"
    | "document-end"
    | "inside";
  readonly at: OpPosition;
  readonly target: PlacementTarget;
  readonly afterId?: string;
  /** The container a block goes inside, for `inside`. */
  readonly insideId?: string;
}

/**
 * Where a click in the Add panel may put a block, in the order they are tried.
 *
 * As the editor's rule says (after the selection; inside it only last):
 * - nothing selected, or a selection the document no longer holds: the end of
 *   the page;
 * - otherwise after the selected block, in its own region, then after each
 *   block it sits in, out to the page, so a block the selection's region
 *   refuses goes after the nearest container that can hold it; and last,
 *   inside the selection when it is a container, so a block that only
 *   belongs inside one (an accordion's item, say) goes where the author
 *   pointed once nothing after it would take it;
 * - `inside`, a container the author chose to add into (its "+"): that
 *   container's region alone, at its end.
 *
 * The same list for every block; which place a given block takes is
 * {@link insertionFor}'s question, asked of the placement rule.
 */
export function insertionCandidates(
  document: BlockDocument,
  selectedId: string | null,
  options: { readonly inside?: string; readonly slots?: SlotSource } = {}
): InsertionCandidate[] {
  if (options.inside !== undefined) {
    return insideCandidates(document, options.inside, options.slots);
  }
  const end: InsertionCandidate = {
    kind: "document-end",
    at: { index: document.nodes.length },
    target: { kind: "root" },
  };
  if (selectedId === null) return [end];
  const candidates: InsertionCandidate[] = [];
  let current: string | undefined = selectedId;
  // Bounded by the document's depth: each step moves one parent out.
  while (current !== undefined) {
    const location = locateNode(document.nodes, current);
    const after =
      location === undefined
        ? undefined
        : afterCandidate(location, current, current === selectedId);
    if (location === undefined || after === undefined) break;
    candidates.push(after);
    current = location.parent?.id;
  }
  if (candidates.length === 0) return [end];
  return [
    ...candidates,
    ...insideCandidates(document, selectedId, options.slots),
  ];
}

/** The end of a container's region the author chose to add into, if it has one. */
function insideCandidates(
  document: BlockDocument,
  insideId: string,
  slots: SlotSource | undefined
): InsertionCandidate[] {
  const container = findNode(document.nodes, insideId);
  if (container === undefined) return [];
  const slot =
    emptySlotOf(container, slots) ??
    slots?.shownSlotOf?.(container) ??
    Object.keys(container.slots ?? {})[0];
  if (slot === undefined) return [];
  const held = container.slots?.[slot] ?? [];
  return [
    {
      kind: "inside",
      at: { parentId: container.id, slot, index: held.length },
      target: { kind: "slot", parentType: container.type, slot },
      insideId: container.id,
    },
  ];
}

/**
 * The place just after one block in its own region, or `undefined` where no op
 * can name it (a parent with no named slot).
 */
function afterCandidate(
  location: NonNullable<ReturnType<typeof locateNode>>,
  id: string,
  selected: boolean
): InsertionCandidate | undefined {
  let here: OpPosition;
  try {
    here = positionOf(location);
  } catch {
    return undefined;
  }
  return {
    kind: selected ? "after-selection" : "after-ancestor",
    at: { ...here, index: here.index + 1 },
    target:
      location.parent === undefined
        ? { kind: "root" }
        : {
            kind: "slot",
            parentType: location.parent.type,
            slot: location.slot ?? "",
          },
    afterId: id,
  };
}

/**
 * The place a block takes: the first of the candidates whose region accepts
 * it, by the caller's reading of the placement rule, or `undefined` when none
 * does (and the panel says why).
 */
export function insertionFor<T>(
  candidates: readonly InsertionCandidate[],
  accepts: (candidate: InsertionCandidate) => T | undefined
): { readonly candidate: InsertionCandidate; readonly answer: T } | undefined {
  for (const candidate of candidates) {
    const answer = accepts(candidate);
    if (answer !== undefined) return { candidate, answer };
  }
  return undefined;
}
