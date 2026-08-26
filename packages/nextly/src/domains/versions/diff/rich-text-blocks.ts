/**
 * Project a rich-text document into comparable blocks.
 *
 * A comparison is only ever about what its projection kept, so this keeps
 * everything a user can change. Each top-level child of the document becomes
 * one block; within a block, every property of every descendant — its text
 * included — is recorded under the path taken to reach it, and equality is
 * decided over that whole record.
 *
 * Participation is the DEFAULT and only the exclusions are listed. Enumerating
 * which properties matter does not converge — the editor registers twenty node
 * types and almost none of their properties survives a text-only projection —
 * so the rule is inverted: everything is compared unless there is a stated
 * reason it must not be. A property a later editor version adds is then
 * compared rather than silently dropped until someone notices a wrong answer.
 *
 * Recording text PATH-QUALIFIED as well as flat is what makes structure part of
 * equality. A list whose items read `ab`, `c` and one whose items read `a`, `bc`
 * flatten to the same `abc`; their per-item records differ, so the edit is
 * reported rather than hidden.
 *
 * Decorators (images, galleries, videos, buttons) need no special handling:
 * their identity lives in ordinary properties — `src`, `images`, `buttons` —
 * which the same rule already records. An earlier version folded a synthetic
 * identity marker into the block's text instead, which both leaked marker
 * glyphs into what the reader saw and refused to compare any decorator whose
 * identity was not a top-level string; `GalleryNode` and `ButtonGroupNode` are
 * both of that shape, so a document containing either compared as changed
 * against itself.
 *
 * @module domains/versions/diff/rich-text-blocks
 */

/**
 * Properties never compared, each for a stated reason. This list is the thing
 * a reviewer should argue with: every entry makes a falsifiable claim that a
 * user cannot change that property.
 */
const EXCLUDED_PROPS = new Set([
  // Traversed structurally; each child's own properties are recorded under its
  // own path, so comparing the array as a value would report the same content
  // twice and make the report depend on serialisation order.
  "children",
  // The editor's node schema version. It moves when the library is upgraded,
  // never by an authoring action.
  "version",
  // Derived from the text's script (ltr/rtl). It moves only when the text
  // moves, which the text comparison already reports.
  "direction",
]);

/**
 * How deep a document may nest before the projection refuses it.
 *
 * Rich-text validation only checks that the root's children are node-shaped, so
 * a crafted or corrupted value can nest arbitrarily. Recursing it would exhaust
 * the call stack and turn a comparison request into a server error; refusing
 * returns a bounded "not comparable" instead. Far above anything an editor
 * produces — a deeply nested list reaches single digits.
 */
const MAX_DEPTH = 100;

/** One top-level block of a document, reduced to what a comparison reads. */
export interface ComparableBlock {
  /** The block's node type: paragraph, heading, quote, list, ... */
  blockType: string;
  /** The block's readable text, for a word-level comparison and for display. */
  text: string;
  /** Every comparable property of every node in the block, path-qualified. */
  attrs: Record<string, unknown>;
  /**
   * True when the block held something this could not read, so equality of the
   * rest cannot be reported as equality of the block.
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

/** Accumulator for one block's walk. */
interface Walked {
  text: string;
  attrs: Record<string, unknown>;
  unsupported: boolean;
}

/**
 * Walk one block, accumulating its readable text and every comparable property
 * of every node inside it.
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
function walk(
  node: RichTextNode,
  path: string,
  depth: number,
  out: Walked
): void {
  if (depth > MAX_DEPTH) {
    out.unsupported = true;
    return;
  }

  for (const [key, value] of Object.entries(node)) {
    if (EXCLUDED_PROPS.has(key)) continue;
    out.attrs[`${path}.${key}`] = value;
  }

  // Text is recorded twice, on purpose. Flat, it is what the reader sees and
  // what the word-level comparison runs over; path-qualified (by the loop
  // above, since `text` is not excluded) it makes WHERE the text sits part of
  // equality, so moving a word between two list items is a change even though
  // the flattened block is identical.
  if (typeof node.text === "string") {
    out.text += node.text;
  }

  const children = node.children;
  if (!Array.isArray(children)) return;

  children.forEach((child, index) => {
    const childNode = asNode(child);
    if (!childNode) {
      // A child this cannot read. Recorded as a refusal rather than skipped:
      // `children` is not compared as a value, so skipping would let a document
      // containing an unreadable child compare equal to one without it.
      out.unsupported = true;
      return;
    }
    walk(
      childNode,
      `${path}/${index}:${childNode.type ?? "?"}`,
      depth + 1,
      out
    );
  });
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
    const node = asNode(child);
    if (!node) {
      return {
        blockType: "unknown",
        text: "",
        attrs: {},
        unsupported: true,
      };
    }
    const out: Walked = { text: "", attrs: {}, unsupported: false };
    // The block itself is the path root, so its keys are the same wherever it
    // sits in the document.
    walk(node, "", 0, out);
    return {
      blockType: node.type ?? "unknown",
      text: out.text,
      attrs: out.attrs,
      unsupported: out.unsupported,
    };
  });
}

/**
 * The string two blocks are ALIGNED by — which is a coarser question than
 * whether they are equal.
 *
 * Alignment decides which block on one side corresponds to which on the other;
 * equality then decides whether that pair changed. So the key carries the block
 * TYPE as well as its text: without it, inserting a heading that reads `Same`
 * above a paragraph that reads `Same` pairs the old paragraph with the new
 * heading and reports the untouched paragraph as added.
 *
 * It deliberately does NOT carry attributes. A heading demoted from h2 to h3
 * keeps its text and must align with its old self so the change reads as one
 * changed block, not as a removal beside an addition.
 */
export function blockAlignKey(block: ComparableBlock): string {
  // A private-use separator, so a block type cannot run into the text.
  return `${block.blockType}\u{E011}${block.text}`;
}
