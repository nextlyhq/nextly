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
import { locateNode, type NodeLocation } from "./tree";

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
  /**
   * The node that was FOUND here, carried rather than left to be looked up.
   *
   * An id is not an identity on a stored document nothing validated: two nodes
   * may carry the same one, and two lookups then disagree about which is meant.
   * They disagree in a way no reader would predict — the search behind this one
   * checks every root before descending, while a plain find walks each root and
   * its descendants in turn, so a nested node and a later top-level node
   * sharing an id resolve to different nodes in the two. Carrying the node the
   * search actually reached removes the second lookup instead of trying to make
   * the two agree.
   */
  readonly node: BlockNode;
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
  let parent: BlockNode | undefined;
  let slot: string | undefined;
  let anchored = false;

  for (const id of ids) {
    const at = locateNode(nodes, id);
    // Told apart from "split" deliberately. An id the document does not hold is
    // a caller that is out of step with the document; blocks in two containers
    // is an author who selected across a boundary. One is a bug and the other
    // is a sentence to show, and a single refusal would send both to whichever
    // was written first.
    if (at === undefined) return { problem: "unknown" };
    if (!anchored) {
      parent = at.parent;
      slot = at.slot;
      anchored = true;
      // A separate flag rather than `parentId === undefined`, because that is
      // what a TOP-LEVEL run legitimately looks like — using it as "not yet
      // seen" would re-anchor on every root and read a whole document as one
      // list.
    } else if (at.parent !== parent || at.slot !== slot) {
      // Compared FIELD BY FIELD, never as one joined string. Both halves are
      // arbitrary text — validation asks a node id only to be a non-empty
      // string, and these primitives run on stored documents nothing validated
      // — so any separator can appear inside them, and a joined key merges two
      // real containers. Measured with `parentId: "a"` / slot `"b c"` against
      // `parentId: "a b"` / slot `"c"`: both spell `"a b c"`, the selection was
      // accepted as one contiguous run, and the pattern was saved from the
      // first container's blocks while the ones the author picked in the second
      // were dropped. Silently, and only for documents whose ids happen to
      // contain the separator.
      return { problem: "split" };
    }
    const node = nodeAt(nodes, at);
    // Unreachable: `locateNode` just read this node out of that very list. It
    // is checked rather than asserted because the alternative is a run holding
    // an `undefined` node, which every later step would treat as a block.
    if (node === undefined) return { problem: "unknown" };
    places.push({ id, index: at.index, node });
  }

  places.sort((left, right) => left.index - right.index);
  const parentId = parent?.id;
  return {
    run: {
      ...(parentId === undefined ? {} : { parentId }),
      ...(slot === undefined ? {} : { slot }),
      places,
    },
  };
}

/** The node a location names, read out of the very list it was found in. */
function nodeAt(nodes: BlockNode[], at: NodeLocation): BlockNode | undefined {
  if (at.parent === undefined) return nodes[at.index];
  const children =
    at.slot === undefined ? undefined : at.parent.slots?.[at.slot];
  return Array.isArray(children) ? children[at.index] : undefined;
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
