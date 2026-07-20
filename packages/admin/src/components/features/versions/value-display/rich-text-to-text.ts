/**
 * Plain text from a Lexical document.
 *
 * A read-only view of rich text has three options: mount a Lexical editor with
 * editing disabled, render serialized HTML, or extract text. Mounting an editor
 * carries a full editing runtime to display immutable content and, because
 * Lexical reads its initial state once, shows stale content when the surrounding
 * view switches between documents. Rendering HTML would mean injecting markup
 * produced elsewhere into the admin. Text extraction avoids both, and is the
 * same shape a textual diff consumes.
 *
 * The trade is formatting: headings, bold, and links render as their text.
 * Block boundaries are preserved so paragraphs and list items stay separate.
 *
 * @module components/features/versions/value-display/rich-text-to-text
 */

/** Node types that end a block, so their text does not run into the next one. */
const BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "listitem",
  "quote",
  "code",
]);

interface LexicalNode {
  type?: string;
  text?: string;
  children?: unknown[];
  [key: string]: unknown;
}

/**
 * Properties that carry visible text on decorator nodes — images, videos,
 * galleries, buttons. Those nodes hold no `text` and often no `children`, so a
 * document made only of media would otherwise extract as empty and display as
 * though the field were never filled in.
 */
const TEXT_BEARING_PROPS = ["caption", "altText", "title", "label"] as const;

function asNode(value: unknown): LexicalNode | null {
  if (typeof value !== "object" || value === null) return null;
  return value as LexicalNode;
}

/** Whether a value looks like a Lexical document rather than arbitrary JSON. */
export function isLexicalDocument(value: unknown): boolean {
  const root = (asNode(value) as { root?: unknown } | null)?.root;
  const node = asNode(root);
  return node?.type === "root" && Array.isArray(node.children);
}

function collect(node: LexicalNode | null, lines: string[]): void {
  if (!node) return;

  for (const prop of TEXT_BEARING_PROPS) {
    const text = node[prop];
    if (typeof text === "string" && text.trim().length > 0) {
      lines.push(text.trim());
    }
  }

  if (typeof node.text === "string" && node.text.length > 0) {
    // Text nodes append to the block being built rather than starting one.
    // A malformed document can carry text before any block has opened, so a
    // block is opened here rather than writing to index -1, which would set a
    // named property on the array and silently drop the content.
    if (lines.length === 0) lines.push("");
    lines[lines.length - 1] = (lines[lines.length - 1] ?? "") + node.text;
  }

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      const childNode = asNode(child);
      const startsBlock =
        childNode?.type !== undefined && BLOCK_TYPES.has(childNode.type);
      if (startsBlock) lines.push("");
      collect(childNode, lines);
    }
  }
}

/**
 * Extract readable text from a Lexical document, one line per block.
 *
 * Anything that is not a Lexical document yields an empty string rather than a
 * dump of its JSON: showing serialized editor internals to an editor reads as a
 * bug, and an empty result lets the caller fall back to its own empty state.
 */
export function richTextToText(value: unknown): string {
  if (!isLexicalDocument(value)) return "";

  const root = asNode((asNode(value) as { root?: unknown } | null)?.root);
  const lines: string[] = [];
  collect(root, lines);

  return lines
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join("\n");
}
