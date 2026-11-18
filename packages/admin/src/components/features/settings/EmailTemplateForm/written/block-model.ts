/**
 * The edits a written email's block list makes, as pure functions over the
 * stored document: add, move, drop, duplicate, remove and put back. Each
 * returns a new document and leaves the one it was given unchanged, so the
 * form's value is only ever replaced, and a list's blocks stay inside it.
 *
 * @module components/features/settings/EmailTemplateForm/written/block-model
 */
import type {
  WrittenBlock,
  WrittenDocument,
} from "@admin/services/emailTemplateApi";

/** The kinds of block a written email holds. */
export type BlockKind = WrittenBlock["type"];

/** A block a list can repeat: anything but another list. */
type ContentBlock = Exclude<WrittenBlock, { type: "list" }>;
type ListBlock = Extract<WrittenBlock, { type: "list" }>;

/**
 * Where a block sits: its index at the top level, or its list's index and
 * its own inside that list.
 */
export type BlockPath = readonly [number] | readonly [number, number];

/** A block taken out, and where it was, so Undo can put it back. */
export interface RemovedBlock {
  block: WrittenBlock;
  path: BlockPath;
}

/**
 * A new block of a kind, shaped as the written rules shape it. Fields a
 * person has to fill (a button's link, an image, a list's variable) start
 * empty, and the save says what is missing.
 */
export function newBlock(kind: BlockKind): WrittenBlock {
  switch (kind) {
    case "heading":
      return { type: "heading", text: [] };
    case "text":
      return { type: "text", text: [] };
    case "button":
      return {
        type: "button",
        label: [{ type: "text", text: "Button" }],
        link: { url: "" },
      };
    case "image":
      return { type: "image", src: { url: "" }, alt: [] };
    case "divider":
      return { type: "divider" };
    case "spacer":
      return { type: "spacer" };
    case "list":
      return { type: "list", variable: "", blocks: [] };
  }
}

/** The blocks of the top level, or of the list at `list`. */
function siblings(
  doc: WrittenDocument,
  list: number | undefined
): readonly WrittenBlock[] {
  if (list === undefined) return doc.blocks;
  const holder = doc.blocks[list];
  if (holder?.type !== "list") {
    throw new Error(`Block ${list} is not a list.`);
  }
  return holder.blocks;
}

/** The document with the blocks of the top level, or of a list, replaced. */
function withSiblings(
  doc: WrittenDocument,
  list: number | undefined,
  blocks: WrittenBlock[]
): WrittenDocument {
  if (list === undefined) return { ...doc, blocks };
  const holder = doc.blocks[list] as ListBlock;
  if (blocks.some(block => block.type === "list")) {
    throw new Error("A list can't hold another list.");
  }
  const next = [...doc.blocks];
  next[list] = { ...holder, blocks: blocks as ContentBlock[] };
  return { ...doc, blocks: next };
}

/** The list a path is in, if any, and its index among its siblings. */
function place(path: BlockPath): [number | undefined, number] {
  return path.length === 1 ? [undefined, path[0]] : [path[0], path[1]];
}

/** The path of the block at `index` among the siblings of `list`. */
function pathTo(list: number | undefined, index: number): BlockPath {
  return list === undefined ? [index] : [list, index];
}

/** A new block of `kind` at the end of the top level, or of a list. */
export function addBlock(
  doc: WrittenDocument,
  kind: BlockKind,
  list?: number
): { doc: WrittenDocument; path: BlockPath } {
  const blocks = [...siblings(doc, list), newBlock(kind)];
  return {
    doc: withSiblings(doc, list, blocks),
    path: pathTo(list, blocks.length - 1),
  };
}

/** The block at `path` moved one place up (-1) or down (1); unchanged at an end. */
export function moveBlock(
  doc: WrittenDocument,
  path: BlockPath,
  by: -1 | 1
): WrittenDocument {
  const [list, index] = place(path);
  const target = index + by;
  if (target < 0 || target >= siblings(doc, list).length) return doc;
  return moveBlockTo(doc, path, target);
}

/** The block at `path` dropped at `to` among its own siblings. */
export function moveBlockTo(
  doc: WrittenDocument,
  path: BlockPath,
  to: number
): WrittenDocument {
  const [list, index] = place(path);
  const blocks = [...siblings(doc, list)];
  const [block] = blocks.splice(index, 1);
  blocks.splice(to, 0, block);
  return withSiblings(doc, list, blocks);
}

/** A copy of the block at `path`, just after it, and the copy's path. */
export function duplicateBlock(
  doc: WrittenDocument,
  path: BlockPath
): { doc: WrittenDocument; path: BlockPath } {
  const [list, index] = place(path);
  const blocks = [...siblings(doc, list)];
  blocks.splice(index + 1, 0, structuredClone(blocks[index]));
  return {
    doc: withSiblings(doc, list, blocks),
    path: pathTo(list, index + 1),
  };
}

/** The document without the block at `path`, and what Undo needs to put it back. */
export function removeBlock(
  doc: WrittenDocument,
  path: BlockPath
): { doc: WrittenDocument; removed: RemovedBlock } {
  const [list, index] = place(path);
  const blocks = [...siblings(doc, list)];
  const [block] = blocks.splice(index, 1);
  return { doc: withSiblings(doc, list, blocks), removed: { block, path } };
}

/** A removed block put back where it was. */
export function restoreBlock(
  doc: WrittenDocument,
  removed: RemovedBlock
): WrittenDocument {
  const [list, index] = place(removed.path);
  const blocks = [...siblings(doc, list)];
  blocks.splice(Math.min(index, blocks.length), 0, removed.block);
  return withSiblings(doc, list, blocks);
}

/** The document with the block at `path` replaced. */
export function updateBlock(
  doc: WrittenDocument,
  path: BlockPath,
  block: WrittenBlock
): WrittenDocument {
  const [list, index] = place(path);
  const blocks = [...siblings(doc, list)];
  blocks[index] = block;
  return withSiblings(doc, list, blocks);
}
