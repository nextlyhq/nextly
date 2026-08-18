/**
 * Duplicating a block: the copy, and where it goes.
 *
 * The most-reached-for verb in a page builder after inserting one. An author
 * builds a card the way they want it and then wants three of them, and without
 * this the only route is to insert a fresh block and redo every property by
 * hand — which is also how the second card ends up subtly different from the
 * first.
 *
 * ## The copy is made by the ENGINE, not here
 *
 * `reidSubtree` mints a fresh id for the node and for everything inside it.
 * That is not a detail: ids are the only thing this editor addresses by, so a
 * copy that kept them would give one id two nodes, and every op afterwards
 * would reach whichever the walk found first — an edit to the copy landing on
 * the original, silently.
 *
 * It also drops `cssId` and any `attributes.id`, because those become DOM ids
 * and two elements carrying one id is invalid HTML that breaks every
 * `getElementById` and every in-page anchor. Both rules belong to what a COPY
 * is rather than to what this command does, and restating either here would be
 * a second opinion about the same question.
 *
 * ## What this decides, because the engine deliberately does not
 *
 * **Where it goes** — immediately after the original, in the same parent and
 * slot. An author duplicating a card is building a row of them, and a copy
 * appended to the end of the page is one they then have to go and find.
 *
 * **What it is called.** A name the author typed is theirs, and two rows
 * reading "Hero title" in the layers panel is exactly the confusion naming
 * exists to remove — so a named block's copy is suffixed. An UNNAMED block's
 * copy stays unnamed: it shows its block's label, two rows reading "Heading"
 * are what an author expects from two headings, and inventing "Heading copy"
 * would put a name on a block whose author never gave it one.
 *
 * **The lock travels.** `locked` is copied because it is part of the block
 * being duplicated, and a copy that quietly differed from its original in one
 * field would be a worse surprise than one that matches. The copy is announced,
 * and the layers panel shows the badge, so the author is not left wondering why
 * the new block will not move.
 *
 * @module duplicate-block
 */

import {
  findNode,
  locateNode,
  reidSubtree,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import { layerLabel } from "./layers";
import { positionOf, type OpPosition } from "./ops";

/** The suffix that keeps two copies of a named block apart. */
export const COPY_SUFFIX = " copy";

/** A duplication, ready to apply. */
export interface BlockDuplication {
  /** The re-id'd copy, with its name adjusted. */
  readonly node: BlockNode;
  /** Immediately after the original, in the same parent and slot. */
  readonly at: OpPosition;
  /** What to call the block in an announcement. */
  readonly label: string;
}

/**
 * The copy's name.
 *
 * Suffixed only when the author gave one. Repeated duplication produces "Hero
 * title copy copy" rather than counting, which is honest about what happened
 * and needs no scan of the document to find the highest number — a count would
 * have to decide what to do about a name the author had since edited, and there
 * is no answer to that which is not a guess.
 */
function copyName(node: BlockNode): string | undefined {
  const named = node.name?.trim();
  if (named === undefined || named === "") return undefined;
  return `${named}${COPY_SUFFIX}`;
}

/**
 * What duplicating the selected block would do, or `null` when it cannot.
 *
 * `null` for no selection and for an id the document no longer holds — which an
 * undo produces routinely — and for a node whose parent has no named slot,
 * because that is a position the op vocabulary cannot express and therefore one
 * an insert could not be undone from.
 */
export function blockDuplication(
  document: BlockDocument,
  selectedId: string | null
): BlockDuplication | null {
  if (selectedId === null) return null;

  const original = findNode(document.nodes, selectedId);
  if (original === undefined) return null;

  const location = locateNode(document.nodes, selectedId);
  if (location === undefined) return null;

  let at: OpPosition;
  try {
    const here = positionOf(location);
    at = { ...here, index: here.index + 1 };
  } catch {
    // `positionOf` refuses a parent with no named slot. That refusal is about
    // the selected node's surroundings rather than anything the author did, so
    // it is reported as "no answer" rather than raised at them — the same
    // reading the inserter gives it.
    return null;
  }

  const copy = reidSubtree(original);
  const name = copyName(original);
  return {
    node: name === undefined ? copy : { ...copy, name },
    at,
    label: layerLabel(original),
  };
}
