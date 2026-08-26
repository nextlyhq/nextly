/**
 * Build a rich-text field's diff node from two documents.
 *
 * Blocks are aligned by their text projection, then each aligned pair is
 * compared on BOTH its text (word-wise) and its non-text attributes, so a
 * change that leaves the text identical is still reported.
 *
 * A block whose content could not be read reports `"unsupported"` and forces
 * the FIELD off `unchanged`, because the dispatcher filters unchanged fields
 * out of a modified-only comparison and an unreadable block must not disappear
 * behind an equality that was never established.
 *
 * Content and presence are answered separately. A side that is present but
 * unreadable loses its content answer only: which sides held anything is still
 * known, so an absent-to-unreadable field reports `added` rather than the
 * vaguer `changed`.
 *
 * @module domains/versions/diff/rich-text-node
 */

import { alignUnits } from "./align-units";
import { presenceStatus } from "./presence-status";
import { toComparableBlocks, type ComparableBlock } from "./rich-text-blocks";
import { diffText } from "./text-diff";
import type {
  DiffStatus,
  NodeMeta,
  RichTextBlockDiff,
  RichTextFieldDiff,
} from "./types";

/**
 * A whole-field refusal: nothing about the CONTENT of this comparison can be
 * claimed.
 *
 * The field's status is still reported as precisely as the evidence allows.
 * Whether a side was there at all is knowable even when what it held is not, so
 * a field that went from absent to unreadable reports `added` rather than
 * collapsing to `changed` — that is strictly more than "something happened",
 * and it is true.
 */
function refuse(meta: NodeMeta, status: DiffStatus): RichTextFieldDiff {
  return {
    ...meta,
    kind: "richText",
    status,
    blocks: [{ blockType: "unknown", status: "unsupported" }],
  };
}

/**
 * Whether two blocks agree on every property that is not their text.
 *
 * Serialised rather than compared structurally: these values come from a
 * snapshot and are plain JSON by construction, and a stable serialisation is
 * enough to answer "did this change" without a deep-equality dependency.
 */
function attrsEqual(a: ComparableBlock, b: ComparableBlock): boolean {
  const keys = new Set([...Object.keys(a.attrs), ...Object.keys(b.attrs)]);
  for (const key of keys) {
    if (JSON.stringify(a.attrs[key]) !== JSON.stringify(b.attrs[key])) {
      return false;
    }
  }
  return true;
}

/** One side of a pair the other side never had. */
function oneSidedBlock(
  block: ComparableBlock,
  status: "added" | "removed"
): RichTextBlockDiff {
  if (block.unsupported) {
    return { blockType: block.blockType, status: "unsupported" };
  }
  return {
    blockType: block.blockType,
    status,
    segments:
      status === "added" ? diffText("", block.text) : diffText(block.text, ""),
  };
}

/** A pair present on both sides, which may still differ in either dimension. */
function pairedBlock(
  from: ComparableBlock,
  to: ComparableBlock,
  textMatched: boolean
): RichTextBlockDiff {
  if (from.unsupported || to.unsupported) {
    return { blockType: to.blockType, status: "unsupported" };
  }
  // Text agreeing is not the whole question: a heading level, a link target or
  // an inline format can change while every word stays where it was.
  const changed =
    !textMatched || from.blockType !== to.blockType || !attrsEqual(from, to);
  return {
    blockType: to.blockType,
    status: changed ? "changed" : "unchanged",
    segments: textMatched
      ? [{ op: 0, text: to.text }]
      : diffText(from.text, to.text),
  };
}

export function richTextNode(
  meta: NodeMeta,
  before: unknown,
  after: unknown
): RichTextFieldDiff {
  // A field never filled in stores null. That is an absence with a known
  // meaning rather than something unreadable, so it projects as an empty
  // document and the first paragraph reads as an addition.
  const beforeAbsent = before == null;
  const afterAbsent = after == null;
  const beforeBlocks = beforeAbsent ? [] : toComparableBlocks(before);
  const afterBlocks = afterAbsent ? [] : toComparableBlocks(after);

  // A side that is PRESENT but not a rich-text document at all. Its content
  // cannot be projected, but which sides held anything still can be, so the
  // presence answer is kept rather than discarded with the content one.
  if (beforeBlocks === null || afterBlocks === null) {
    return refuse(meta, presenceStatus(beforeAbsent, afterAbsent, "changed"));
  }

  const alignment = alignUnits(
    beforeBlocks.map(b => b.text),
    afterBlocks.map(b => b.text)
  );
  // Too large to align. Unlike the case above this says nothing about presence
  // either, since both sides were readable documents.
  if (!alignment.aligned) return refuse(meta, "changed");

  const blocks: RichTextBlockDiff[] = alignment.pairs.map(pair => {
    if (pair.status === "added") {
      const block = afterBlocks[pair.toIndex];
      return block
        ? oneSidedBlock(block, "added")
        : { blockType: "unknown", status: "unsupported" };
    }
    if (pair.status === "removed") {
      const block = beforeBlocks[pair.fromIndex];
      return block
        ? oneSidedBlock(block, "removed")
        : { blockType: "unknown", status: "unsupported" };
    }
    const from = beforeBlocks[pair.fromIndex];
    const to = afterBlocks[pair.toIndex];
    if (!from || !to) return { blockType: "unknown", status: "unsupported" };
    return pairedBlock(from, to, pair.status === "unchanged");
  });

  const status = blocks.some(b => b.status !== "unchanged")
    ? "changed"
    : "unchanged";
  return { ...meta, kind: "richText", status, blocks };
}
