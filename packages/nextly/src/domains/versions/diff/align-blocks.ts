/**
 * Pair the blocks of two rich-text documents.
 *
 * Two passes, because one key cannot answer both halves of the question.
 *
 * A COARSE key — type and text — is what lets an attribute-only edit stay in
 * place: a heading demoted from h2 to h3 keeps its text, aligns with its old
 * self, and reads as one changed block rather than as a removal beside an
 * addition. It is also what survives insertions between such edits, which a
 * strict key cannot: with two headings retagged and a paragraph inserted
 * between them, nothing matches exactly, and the whole region collapses into
 * one removal run met by one insertion run that pairs positionally — putting
 * the second heading against the new paragraph.
 *
 * The same coarseness is a defect on its own, because blocks sharing a type and
 * a text are then interchangeable. Inserting a third such block among two
 * existing ones pairs each with its neighbour's attributes, so a reader who
 * added one block is shown two edits and an addition, none of them the edit
 * they made.
 *
 * So blocks that are IDENTICAL are matched first and become anchors, and the
 * coarse key runs only on what sits between them. Neither pass can report a
 * pair as unchanged on its own — that is decided from the blocks afterwards —
 * so a pass that pairs badly costs a worse reading and never a wrong one.
 *
 * @module domains/versions/diff/align-blocks
 */

import { alignUnits, type UnitPair } from "./align-units";
import {
  blockAlignKey,
  blockExactKey,
  type ComparableBlock,
} from "./rich-text-blocks";

/**
 * Which block on one side corresponds to which on the other.
 *
 * Deliberately carries no unit strings. The two passes align by different keys,
 * so a pair's key says which pass produced it rather than anything about the
 * block — and a caller reading one would be reading an implementation detail
 * that changes under it.
 */
export type BlockPair =
  | { status: "unchanged"; fromIndex: number; toIndex: number }
  | { status: "changed"; fromIndex: number; toIndex: number }
  | { status: "added"; toIndex: number }
  | { status: "removed"; fromIndex: number };

/** Drop the unit strings an alignment pair carries. */
function toBlockPair(pair: UnitPair): BlockPair {
  if (pair.status === "added") {
    return { status: "added", toIndex: pair.toIndex };
  }
  if (pair.status === "removed") {
    return { status: "removed", fromIndex: pair.fromIndex };
  }
  return {
    status: pair.status,
    fromIndex: pair.fromIndex,
    toIndex: pair.toIndex,
  };
}

/** The same pair, expressed against the whole document rather than a region. */
function shift(pair: UnitPair, fromStart: number, toStart: number): BlockPair {
  if (pair.status === "added") {
    return { status: "added", toIndex: pair.toIndex + toStart };
  }
  if (pair.status === "removed") {
    return { status: "removed", fromIndex: pair.fromIndex + fromStart };
  }
  return {
    status: pair.status,
    fromIndex: pair.fromIndex + fromStart,
    toIndex: pair.toIndex + toStart,
  };
}

/** Every index a run of pairs covers on one side, in order. */
function fromIndices(run: readonly UnitPair[]): number[] {
  return run.flatMap(p => (p.status === "added" ? [] : [p.fromIndex]));
}
function toIndices(run: readonly UnitPair[]): number[] {
  return run.flatMap(p => (p.status === "removed" ? [] : [p.toIndex]));
}

/**
 * Re-pair one stretch of blocks the exact pass could not anchor.
 *
 * A run touching only one side is already the whole answer — there is nothing
 * on the other side to pair it with — and a region the coarse pass cannot align
 * keeps the exact pass's reading rather than refusing the field over it.
 */
function refine(
  run: readonly UnitPair[],
  before: readonly ComparableBlock[],
  after: readonly ComparableBlock[]
): BlockPair[] {
  const from = fromIndices(run);
  const to = toIndices(run);
  const fromStart = from[0];
  const toStart = to[0];
  if (fromStart === undefined || toStart === undefined) {
    return run.map(toBlockPair);
  }

  const coarse = alignUnits(
    before.slice(fromStart, fromStart + from.length).map(blockAlignKey),
    after.slice(toStart, toStart + to.length).map(blockAlignKey)
  );
  if (!coarse.aligned) return run.map(toBlockPair);
  return coarse.pairs.map(pair => shift(pair, fromStart, toStart));
}

/** Run `refine` over every stretch between anchors. */
function refineBetweenAnchors(
  pairs: readonly UnitPair[],
  before: readonly ComparableBlock[],
  after: readonly ComparableBlock[]
): BlockPair[] {
  const out: BlockPair[] = [];
  let run: UnitPair[] = [];
  for (const pair of pairs) {
    if (pair.status !== "unchanged") {
      run.push(pair);
      continue;
    }
    if (run.length > 0) {
      out.push(...refine(run, before, after));
      run = [];
    }
    out.push(toBlockPair(pair));
  }
  if (run.length > 0) out.push(...refine(run, before, after));
  return out;
}

/**
 * Pair two documents' blocks, or null when neither pass could align them.
 *
 * The exact pass names more distinct units than the coarse one, so it is the
 * pass that can exhaust the alignment alphabet first. Falling back to the
 * coarse pass alone rather than refusing keeps a large document comparable,
 * which is what it was before anchoring existed.
 */
export function alignBlocks(
  before: readonly ComparableBlock[],
  after: readonly ComparableBlock[]
): BlockPair[] | null {
  const exact = alignUnits(before.map(blockExactKey), after.map(blockExactKey));
  if (exact.aligned) return refineBetweenAnchors(exact.pairs, before, after);

  const coarse = alignUnits(
    before.map(blockAlignKey),
    after.map(blockAlignKey)
  );
  return coarse.aligned ? coarse.pairs.map(toBlockPair) : null;
}
