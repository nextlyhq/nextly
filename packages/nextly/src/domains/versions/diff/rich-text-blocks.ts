/**
 * Project a rich-text document into comparable blocks.
 *
 * A comparison is only ever about what its projection kept, so this keeps
 * everything a user can change. Each top-level child of the document becomes
 * one block; within a block, the text of every descendant is concatenated for
 * word-level diffing, and every OTHER property of every descendant is carried
 * in `attrs` and compared for equality.
 *
 * Participation is the DEFAULT and only the exclusions are listed. Enumerating
 * which properties matter does not converge — the editor registers twenty node
 * types and almost none of their properties survives a text-only projection —
 * so the rule is inverted: everything is compared unless there is a stated
 * reason it must not be. A property a later editor version adds is then
 * compared rather than silently dropped until someone notices a wrong answer.
 *
 * Decorators (images, galleries, videos, buttons) are INLINE in this editor:
 * `DecoratorNode.isInline()` returns true and none of the five registered
 * decorators overrides it, so an image is a child of a paragraph rather than a
 * block of its own. Its identity therefore folds into the block's text as a
 * sentinel, which makes a swapped image a changed run under the ordinary word
 * diff with no special-casing downstream.
 *
 * @module domains/versions/diff/rich-text-blocks
 */

/**
 * Properties never compared, each for a stated reason. This list is the thing
 * a reviewer should argue with: every entry makes a falsifiable claim that a
 * user cannot change that property.
 */
const EXCLUDED_PROPS = new Set([
  // Traversed structurally rather than compared as a value.
  "children",
  // Concatenated into the block's text and diffed word-wise there. Comparing it
  // here as well would report one edit twice.
  "text",
  // The editor's node schema version. It moves when the library is upgraded,
  // never by an authoring action.
  "version",
  // Derived from the text's script (ltr/rtl). It moves only when the text
  // moves, which the word diff already reports.
  "direction",
]);

/**
 * Properties that can name a decorator's target, in preference order. The
 * first one present becomes the node's identity.
 */
const IDENTITY_PROPS = [
  "src",
  "id",
  "value",
  "url",
  "href",
  "documentId",
] as const;

/**
 * Delimiter for an identity sentinel. A private-use code point, so a sentinel
 * can never collide with authored text and a reader can strip it reliably.
 */
export const IDENTITY_SENTINEL = "\u{E010}";

/** One top-level block of a document, reduced to what a comparison reads. */
export interface ComparableBlock {
  /** The block's node type: paragraph, heading, quote, list, ... */
  blockType: string;
  /** Inline text, with each decorator's identity folded in as a sentinel. */
  text: string;
  /** Every comparable property of every node in the block, path-qualified. */
  attrs: Record<string, unknown>;
  /**
   * True when the block held something whose identity could not be read, so
   * equality of the rest cannot be reported as equality of the block.
   */
  unsupported: boolean;
}

interface RichTextNode {
  type?: string;
  text?: string;
  children?: unknown[];
  [key: string]: unknown;
}

function asNode(value: unknown): RichTextNode | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as RichTextNode;
}

/** The document's root, or null when this is not a rich-text document. */
function rootOf(value: unknown): RichTextNode | null {
  const wrapper = asNode(value);
  if (!wrapper) return null;
  const root = asNode(wrapper.root);
  if (!root || root.type !== "root" || !Array.isArray(root.children)) {
    return null;
  }
  return root;
}

/**
 * A decorator's identity as a sentinel, or null when it names no target.
 *
 * The node type is part of the identity, so replacing an image with a video
 * that happens to share a source still reads as a change.
 */
function identitySentinel(node: RichTextNode): string | null {
  for (const prop of IDENTITY_PROPS) {
    const value = node[prop];
    if (typeof value === "string" && value.length > 0) {
      return `${IDENTITY_SENTINEL}${node.type ?? "node"}:${value}${IDENTITY_SENTINEL}`;
    }
    if (typeof value === "number") {
      return `${IDENTITY_SENTINEL}${node.type ?? "node"}:${value}${IDENTITY_SENTINEL}`;
    }
  }
  return null;
}

/** Whether a node carries text of its own rather than decorating a position. */
function isTextNode(node: RichTextNode): boolean {
  return node.type === "text" || typeof node.text === "string";
}

/** Accumulator for one block's walk. */
interface Walked {
  text: string;
  attrs: Record<string, unknown>;
  unsupported: boolean;
}

/**
 * Walk one block, accumulating its inline text and every comparable property of
 * every node inside it.
 *
 * Attribute keys are qualified by the path taken to reach the node FROM THIS
 * BLOCK, so two nodes in one block cannot overwrite each other's properties and
 * moving a node within the block is itself a change.
 *
 * The path deliberately does not include the block's own position in the
 * document. Alignment already reports a block that moved, and including the
 * position here would give an untouched block different attribute keys either
 * side of an inserted paragraph — reporting it as changed for having shifted,
 * which is the index-based comparison this engine exists to avoid.
 */
function walk(node: RichTextNode, path: string, out: Walked): void {
  for (const [key, value] of Object.entries(node)) {
    if (EXCLUDED_PROPS.has(key)) continue;
    out.attrs[`${path}.${key}`] = value;
  }

  if (isTextNode(node) && typeof node.text === "string") {
    out.text += node.text;
  }

  const children = node.children;
  if (Array.isArray(children)) {
    children.forEach((child, index) => {
      const childNode = asNode(child);
      if (!childNode) return;
      walk(childNode, `${path}/${index}:${childNode.type ?? "?"}`, out);
    });
    return;
  }

  // A leaf that carries no text is a decorator. Its identity goes into the text
  // so an ordinary word diff reports a swap; one whose identity cannot be read
  // is recorded as not comparable rather than treated as absent, because
  // "I could not read this" and "there was nothing here" are different answers.
  if (!isTextNode(node)) {
    const sentinel = identitySentinel(node);
    if (sentinel === null) {
      out.unsupported = true;
      return;
    }
    out.text += sentinel;
  }
}

/**
 * Project a rich-text value into comparable blocks, or null when the value is
 * not a rich-text document at all.
 */
export function toComparableBlocks(value: unknown): ComparableBlock[] | null {
  const root = rootOf(value);
  if (!root) return null;

  const children = Array.isArray(root.children) ? root.children : [];
  return children.map(child => {
    const node = asNode(child) ?? {};
    const out: Walked = { text: "", attrs: {}, unsupported: false };
    // The block itself is the path root, so its keys are the same wherever it
    // sits in the document.
    walk(node, "", out);
    return {
      blockType: node.type ?? "unknown",
      text: out.text,
      attrs: out.attrs,
      unsupported: out.unsupported,
    };
  });
}
