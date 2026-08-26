/**
 * Build a rich-text field's diff node from two documents.
 *
 * Blocks are aligned by type and text, then each aligned pair is compared on
 * BOTH its text (word-wise) and every other property it carries, so a change
 * that leaves the text identical — a swapped image, a repointed link, an
 * un-bolded phrase — is still reported. Which properties differ travels with
 * the block, so the reader is told WHAT changed rather than only that
 * something did.
 *
 * A block this could not read reports `"unsupported"` and forces the FIELD off
 * `unchanged`, because the dispatcher filters unchanged fields out of a
 * modified-only comparison and an unreadable block must not disappear behind an
 * equality that was never established.
 *
 * Content and presence are answered separately, so a field that gained or lost
 * its whole document reports `added` or `removed` rather than the vaguer
 * `changed` — matching how text, value and source fields describe the same
 * event.
 *
 * @module domains/versions/diff/rich-text-node
 */

import { alignUnits } from "./align-units";
import { canonicalJson } from "./canonical-json";
import { presenceStatus } from "./presence-status";
import {
  blockAlignKey,
  toComparableBlocks,
  type ComparableBlock,
} from "./rich-text-blocks";
import { diffText } from "./text-diff";
import type {
  DiffStatus,
  NodeMeta,
  RichTextAttrChange,
  RichTextBlockDiff,
  RichTextFieldDiff,
} from "./types";

/** How many changed attributes travel with a block before the rest are dropped. */
const MAX_ATTR_CHANGES = 12;

/**
 * A whole-field refusal: nothing about the CONTENT of this comparison can be
 * claimed. The status is still as precise as the evidence allows — whether a
 * side was there at all is knowable even when what it held is not.
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
 * A path-qualified attribute key, as something a reader can act on.
 *
 * `/0:text.format` says where in the block the property sits, which matters to
 * this engine and to nobody reading a comparison. The node type and property
 * name are what identify it in words.
 */
function readableAttrName(key: string): string {
  const dot = key.lastIndexOf(".");
  const path = dot === -1 ? "" : key.slice(0, dot);
  const prop = dot === -1 ? key : key.slice(dot + 1);
  const segments = path.split("/").filter(Boolean);
  const last = segments[segments.length - 1];
  const nodeType = last?.split(":")[1];
  return nodeType ? `${nodeType}.${prop}` : prop;
}

/** Whether a path-qualified key names a node's own text. */
function isTextProp(key: string): boolean {
  return key.endsWith(".text");
}

/**
 * Which properties differ between two blocks.
 *
 * Values are compared through a canonical serialisation, so an object-valued
 * attribute — a gallery's image metadata, say — is equal whatever order its
 * keys were written in. Key order is not content, and a serializer upgrade that
 * merely reorders exported properties must not read as an edit.
 */
function attrChanges(
  from: ComparableBlock,
  to: ComparableBlock,
  textMatched: boolean
): RichTextAttrChange[] {
  const keys = [
    ...new Set([...Object.keys(from.attrs), ...Object.keys(to.attrs)]),
  ].sort();
  const changes: RichTextAttrChange[] = [];
  for (const key of keys) {
    const before = from.attrs[key];
    const after = to.attrs[key];
    if (canonicalJson(before) === canonicalJson(after)) continue;
    // A text property is reported only when the word-level comparison did NOT
    // already show it. Both are recorded, because WHERE text sits is part of
    // equality — moving a word between two list items leaves the block's
    // flattened text identical — but repeating a visible edit as a property
    // change is noise, and staying silent about an invisible one leaves the
    // reader told that something happened and not what.
    if (!textMatched && isTextProp(key)) continue;
    changes.push({
      name: readableAttrName(key),
      ...(before === undefined ? {} : { before }),
      ...(after === undefined ? {} : { after }),
    });
  }
  return changes;
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
  const changes = attrChanges(from, to, textMatched);
  const changed =
    !textMatched || from.blockType !== to.blockType || changes.length > 0;

  return {
    blockType: to.blockType,
    status: changed ? "changed" : "unchanged",
    segments: textMatched
      ? [{ op: 0, text: to.text }]
      : diffText(from.text, to.text),
    // Carried so the reader is told which property moved. Bounded, because a
    // block whose every node changed would otherwise send its whole contents a
    // second time; the status already says the block changed.
    ...(changes.length > 0
      ? { attrChanges: changes.slice(0, MAX_ATTR_CHANGES) }
      : {}),
  };
}

/** The block-level comparison for two readable documents. */
function compareBlocks(
  beforeBlocks: readonly ComparableBlock[],
  afterBlocks: readonly ComparableBlock[]
): RichTextBlockDiff[] | null {
  const alignment = alignUnits(
    beforeBlocks.map(blockAlignKey),
    afterBlocks.map(blockAlignKey)
  );
  if (!alignment.aligned) return null;

  const unreadable: RichTextBlockDiff = {
    blockType: "unknown",
    status: "unsupported",
  };

  return alignment.pairs.map(pair => {
    if (pair.status === "added") {
      const block = afterBlocks[pair.toIndex];
      return block ? oneSidedBlock(block, "added") : unreadable;
    }
    if (pair.status === "removed") {
      const block = beforeBlocks[pair.fromIndex];
      return block ? oneSidedBlock(block, "removed") : unreadable;
    }
    const from = beforeBlocks[pair.fromIndex];
    const to = afterBlocks[pair.toIndex];
    if (!from || !to) return unreadable;
    return pairedBlock(from, to, pair.status === "unchanged");
  });
}

export function richTextNode(
  meta: NodeMeta,
  before: unknown,
  after: unknown
): RichTextFieldDiff {
  // A field never filled in stores null. That is an absence with a known
  // meaning rather than something unreadable, so it projects as an empty
  // document and the other side reads as an addition or a removal.
  const beforeAbsent = before == null;
  const afterAbsent = after == null;
  const beforeBlocks = beforeAbsent ? [] : toComparableBlocks(before);
  const afterBlocks = afterAbsent ? [] : toComparableBlocks(after);

  // A side that is PRESENT but not a rich-text document at all. Its content
  // cannot be projected, but which sides held anything still can be.
  if (beforeBlocks === null || afterBlocks === null) {
    return refuse(meta, presenceStatus(beforeAbsent, afterAbsent, "changed"));
  }

  const blocks = compareBlocks(beforeBlocks, afterBlocks);
  // Too large to align. Unlike the case above this says nothing about presence
  // either, since both sides were readable documents.
  if (blocks === null) return refuse(meta, "changed");

  const fromContent: DiffStatus = blocks.some(b => b.status !== "unchanged")
    ? "changed"
    : "unchanged";
  // A field that gained or lost its whole document says so, rather than
  // describing the event as a change to something that was not there.
  const status = presenceStatus(beforeAbsent, afterAbsent, fromContent);

  return { ...meta, kind: "richText", status, blocks };
}
