/**
 * Whether a set of selected nodes is one run of siblings, and where it sits.
 *
 * Asked by two kinds of caller that must not answer it separately. The editor
 * asks it to reorder a multi-block selection — a step through a list has no
 * meaning for blocks in different lists. Every composition planner asks it
 * because a saved pattern, a new component and a converted selection are all
 * ONE contiguous run lifted out of one place, and inserting one back is the
 * inverse of taking it out only if that is true.
 *
 * ## Why it is published from the engine
 *
 * The builder owned a private copy of the first half of this
 * (`selection-ops.ts:sharedRun`), which was right while the editor was the only
 * caller. It stopped being right when the planners arrived: a planner runs
 * inside a plugin's server action as well as in the editor, and the builder
 * cannot be imported there — it peer-depends on React, and the dependency
 * direction is builder → engine, so the engine could not import a builder-side
 * predicate back. One of the two would have had to be a second implementation,
 * and the module that held the first one says why that ends badly: it would
 * eventually disagree with the toolbar and the keyboard, which act through it.
 *
 * ## What it deliberately does NOT decide
 *
 * The sentence an author reads. A refusal is phrased as the REMEDY rather than
 * the rule — "select blocks that share one container" — and the remedy belongs
 * to the verb: moving, saving as a pattern and converting to a component are
 * three different things to be told to do instead. So this reports the CAUSE it
 * observed, as a closed set, and each surface says what to do about it. That is
 * the same division the validator uses between an issue and its suggestion.
 *
 * @module sibling-run
 */
import type { BlockNode } from "./document";
import { locateNode } from "./tree";

/** Why a selection is not one run of siblings. */
export type RunProblem =
  /** Nothing was selected. */
  | "empty"
  /** An id names no node in this document. */
  | "unknown"
  /** They do not all share one parent and slot. */
  | "split"
  /** They share one list, but other blocks sit between them. */
  | "gap";

/** One selected node's place in the list its siblings share. */
export interface RunPlace {
  readonly id: string;
  /** Its index in that sibling list. */
  readonly index: number;
}

/** A selection that all sits in one sibling list. */
export interface SiblingRun {
  /**
   * The node whose slot holds them, or `undefined` at the top level.
   *
   * Reported as an id rather than the node, because a caller that wants the
   * node has the document and a caller that wants to build an op wants the id —
   * and handing back a node from the document invites mutating it.
   */
  readonly parentId?: string;
  /** The slot within that parent, or `undefined` at the top level. */
  readonly slot?: string;
  /** The selected nodes, sorted by their index in that list. */
  readonly places: readonly RunPlace[];
}

/**
 * A run, or the cause there is not one.
 *
 * Both members carry the other field as `undefined` so a caller narrows on
 * `result.run !== undefined` without a type guard, and cannot read a run off a
 * refusal.
 */
export type SiblingRunResult =
  | { readonly run: SiblingRun; readonly problem?: undefined }
  | { readonly problem: RunProblem; readonly run?: undefined };

/**
 * Parent and slot as ONE key.
 *
 * One parent's two slots are two lists, so neither alone identifies the list.
 * The separator is a space, which an id cannot contain, so no pair of distinct
 * containers can collide into a single key.
 */
function listKey(
  parentId: string | undefined,
  slot: string | undefined
): string {
  return `${parentId ?? ""} ${slot ?? ""}`;
}

/**
 * Where each selected node sits, once they all sit in one list.
 *
 * Gaps are ALLOWED here: a reorder steps every selected block one place and
 * does not care whether unselected ones sit between them. Callers that do care
 * ask {@link contiguousRun}.
 *
 * Duplicate ids are not special-cased. `places` reports what it was given, so a
 * caller that passed one id twice gets it twice — the selection model
 * de-duplicates before it reaches here, and inventing a second de-duplication
 * would hide a caller bug rather than fix one.
 */
export function siblingRun(
  nodes: BlockNode[],
  ids: readonly string[]
): SiblingRunResult {
  if (ids.length === 0) return { problem: "empty" };

  const places: RunPlace[] = [];
  let key: string | undefined;
  let parentId: string | undefined;
  let slot: string | undefined;

  for (const id of ids) {
    const at = locateNode(nodes, id);
    // Told apart from "split" deliberately. An id the document does not hold is
    // a caller that is out of step with the document; blocks in two containers
    // is an author who selected across a boundary. One is a bug and the other
    // is a sentence to show, and a single refusal would send both to whichever
    // was written first.
    if (at === undefined) return { problem: "unknown" };
    const here = listKey(at.parent?.id, at.slot);
    if (key === undefined) {
      key = here;
      parentId = at.parent?.id;
      slot = at.slot;
    } else if (key !== here) {
      return { problem: "split" };
    }
    places.push({ id, index: at.index });
  }

  places.sort((left, right) => left.index - right.index);
  return {
    run: {
      ...(parentId === undefined ? {} : { parentId }),
      ...(slot === undefined ? {} : { slot }),
      places,
    },
  };
}

/**
 * The same, refusing a run with anything selected out of it.
 *
 * What contiguity buys is that the run has a PLACE. A pattern saved from three
 * sections separated by a fourth has no single index to be re-inserted at, and
 * converting such a selection to a component would have to remove blocks from
 * two places and leave the one between them stranded between the halves of
 * something that is now one node. Requiring a run makes "put it back" the exact
 * inverse of "take it out", which is what lets insert, convert and detach share
 * one placement rule instead of three.
 */
export function contiguousRun(
  nodes: BlockNode[],
  ids: readonly string[]
): SiblingRunResult {
  const result = siblingRun(nodes, ids);
  if (result.run === undefined) return result;
  return isConsecutive(result.run.places) ? result : { problem: "gap" };
}

/** Whether sorted places step one index at a time. */
function isConsecutive(places: readonly RunPlace[]): boolean {
  const first = places[0];
  if (first === undefined) return false;
  return places.every((place, offset) => place.index === first.index + offset);
}
