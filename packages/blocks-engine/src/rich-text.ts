/**
 * The stored shape of rich text, shared by everything that reads it.
 *
 * Rich text is Lexical's own serialized editor state, and it is stored verbatim
 * — the CMS's rich-text field has always done this, and a block's rich prop now
 * holds the same thing (decision:inline-rich-text-shape, founder, 2026-08-20).
 * An author's rich text is one kind of thing, so it has one stored shape
 * wherever they typed it.
 *
 * ## Why the TYPE lives here and the renderers do not
 *
 * Two things must read this format and they may not import each other. The CMS
 * derives HTML from it for API consumers; `blocks-react` draws it as a React
 * tree, and its layering test forbids it from importing the CMS, the admin or
 * the plugin SDK. So there is no package either of them could share a READER
 * through.
 *
 * They can share a DEFINITION, though, and this package is the one place both
 * already depend on — it is runtime-free by construction, which is what lets a
 * renderer and a server both hold it. A React tree and an HTML string are
 * genuinely different outputs, so two producers is not two implementations of
 * one thing; what would be dangerous is two ideas of what a node IS, and that is
 * the risk this module exists to remove.
 *
 * The risk is not imagined: two renderers in this programme once diverged on
 * condition gating, in opposite directions, and nothing surfaced it until an
 * audit went looking.
 *
 * ## Deliberately permissive
 *
 * Nodes carry an index signature and unknown types are not rejected. Lexical's
 * node set is extensible and this package has no opinion about which nodes a
 * site registered — an unknown node is a rendering question, answered by the
 * renderer's placeholder, not a validation error that would refuse to store
 * content an editor already accepted.
 *
 * @module rich-text
 */

/**
 * One node of stored rich text.
 *
 * `type` is the only field every node has. `children`, `text` and `format` are
 * the ones a reader can rely on when present, and everything else is whatever
 * the node class serialized.
 */
export interface RichTextNode {
  /** The node type, as its Lexical class serializes it — `paragraph`, `text`, `heading`. */
  type: string;
  /** Child nodes, for container types. */
  children?: RichTextNode[];
  /** The text itself, for text nodes. */
  text?: string;
  /** Lexical's format bitfield: bold, italic, underline and the rest. */
  format?: number;
  /** Whatever else the node serialized. */
  [key: string]: unknown;
}

/** A whole rich-text value: Lexical's editor state, rooted. */
export interface RichTextValue {
  root: {
    type: "root";
    children: RichTextNode[];
    [key: string]: unknown;
  };
}

/**
 * Whether a stored value is rich text.
 *
 * Structural, not nominal: it checks for the root a reader would walk, because
 * the value arrives from storage as parsed JSON with no class to ask. A prop
 * holding a string, a number or null is not rich text and this says so — which
 * is what lets a renderer choose between drawing a tree and drawing a string
 * without either guessing.
 */
export function isRichTextValue(value: unknown): value is RichTextValue {
  if (typeof value !== "object" || value === null) return false;
  const root = (value as { root?: unknown }).root;
  if (typeof root !== "object" || root === null) return false;
  const typed = root as { type?: unknown; children?: unknown };
  return typed.type === "root" && Array.isArray(typed.children);
}

/**
 * The plain text inside a rich-text value, for anything that needs words rather
 * than formatting.
 *
 * SEO extraction and search indexing both want this, and both would otherwise
 * write their own walk — which is the second-reader problem this module exists
 * to avoid, in miniature.
 *
 * Block-level nodes are joined with a space rather than concatenated, so two
 * paragraphs do not become one run-on word. Nothing is trimmed beyond that: a
 * caller wanting a summary length has its own rule, and guessing here would give
 * it a different answer than it asked for.
 */
export function richTextToPlainText(value: RichTextValue): string {
  const parts: string[] = [];
  const walk = (nodes: readonly RichTextNode[]): void => {
    for (const node of nodes) {
      if (typeof node.text === "string") parts.push(node.text);
      if (Array.isArray(node.children)) walk(node.children);
    }
  };
  walk(value.root.children);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Lexical's text-format bitfield.
 *
 * Here rather than in each reader because these numbers ARE what a node means.
 * A renderer that re-declared them would agree on the day it was written and
 * disagree the day Lexical adds a format — and the disagreement would show up
 * as text rendering unstyled on one surface and styled on the other, with
 * nothing raised on either.
 *
 * The values are Lexical's own and are part of the stored data: content saved
 * today carries `format: 3` meaning bold-and-italic, so these cannot be
 * renumbered without rewriting every document that used them.
 *
 * NOT YET THE ONLY COPY. `packages/nextly`'s HTML serializer still declares its
 * own, identical set. Converging it is a separate change: that file carries
 * pre-existing complexity findings which a five-line import would pull into
 * whatever PR touched it, and an 88-line serializer deserves a refactor of its
 * own rather than one taken in passing. Until then the drift risk is the one
 * that already existed, and this is the copy new readers should use.
 */
export const TEXT_FORMAT = {
  BOLD: 1,
  ITALIC: 2,
  STRIKETHROUGH: 4,
  UNDERLINE: 8,
  CODE: 16,
  SUBSCRIPT: 32,
  SUPERSCRIPT: 64,
  HIGHLIGHT: 128,
} as const;

/** Whether a node's format bitfield carries one particular format. */
export function hasFormat(
  format: number | undefined,
  flag: (typeof TEXT_FORMAT)[keyof typeof TEXT_FORMAT]
): boolean {
  return ((format ?? 0) & flag) !== 0;
}
