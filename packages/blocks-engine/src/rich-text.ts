/**
 * The stored shape of rich text, shared by everything that reads it.
 *
 * Rich text is Lexical's own serialized editor state, and it is stored verbatim:
 * the CMS's rich-text field holds it, and so does a block's rich prop. An
 * author's rich text is one kind of thing, so it has one stored shape wherever
 * they typed it.
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
 * ## Deliberately permissive about node TYPES, strict about node SHAPE
 *
 * Nodes carry an index signature and unknown `type` values are not rejected.
 * Lexical's node set is extensible and this package has no opinion about which
 * nodes a site registered — an unknown node is a rendering question, answered by
 * the renderer's placeholder, not a validation error that would refuse to store
 * content an editor already accepted.
 *
 * That tolerance stops at shape. A value that is not an object, or whose `type`
 * is not a string, is not a node any reader can walk, and treating it as one
 * turns a malformed stored document into a crash on a published page.
 *
 * @module rich-text
 */

/**
 * The `type` a prop schema declares to say its value is rich text.
 *
 * Here rather than spelled at each end because two ends read it and they must
 * mean the same string: the block library writes it into a schema, and an
 * editor reads it to decide whether a value is a tree or a line of text. A
 * mismatch is silent in the worst possible way — the editor treats a tree as
 * text, reads no text out of it, and commits an empty string over the passage.
 */
export const RICH_TEXT_PROP_TYPE = "richText";

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
 * Whether one value from a `children` array is a node a reader can walk.
 *
 * SHALLOW, and that is the design rather than an omission. The alternative is to
 * validate the whole tree inside {@link isRichTextValue}, which walks every node
 * of a document to answer a question about its root, and then the renderer walks
 * it again to draw it. On a large document that is two full traversals where one
 * would do, and the second one is spent on a value already known to be good.
 *
 * Checking each node as it is reached costs one comparison per node on a walk
 * that was happening anyway, and it holds at every depth — including the nodes a
 * deep validator would have to re-check after any caller built a tree by hand.
 *
 * `type` must be a string because it is what every reader switches on. Nothing
 * else is required: a node's remaining fields belong to its own class, and a
 * reader that wants one checks for it.
 */
export function isRichTextNode(value: unknown): value is RichTextNode {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return typeof (value as { type?: unknown }).type === "string";
}

/**
 * Whether a stored value is rich text.
 *
 * Structural, not nominal: it checks for the root a reader would walk, because
 * the value arrives from storage as parsed JSON with no class to ask. A prop
 * holding a string, a number or null is not rich text and this says so — which
 * is what lets a renderer choose between drawing a tree and drawing a string
 * without either guessing.
 *
 * `children` must be an array. A root without one is not walkable, and the
 * readers of this format all reach for `root.children` immediately.
 */
export function isRichTextValue(value: unknown): value is RichTextValue {
  if (typeof value !== "object" || value === null) return false;
  const root = (value as { root?: unknown }).root;
  if (typeof root !== "object" || root === null) return false;
  const typed = root as { type?: unknown; children?: unknown };
  return typed.type === "root" && Array.isArray(typed.children);
}

/**
 * Node types whose contents run INTO the surrounding text rather than standing
 * apart from it.
 *
 * Everything else that has children is treated as block-level and gets a
 * boundary after it. Listing the inline ones rather than the block ones is what
 * makes this safe for a node type this package has never heard of: an unknown
 * container is far more likely to be a block than an inline wrapper, and
 * guessing block only ever inserts a space that was arguably wanted, where
 * guessing inline runs two paragraphs together.
 */
const INLINE_CONTAINERS: ReadonlySet<string> = new Set(["link", "autolink"]);

/**
 * Marks where a block ended, while the walk is still in progress.
 *
 * A unique symbol rather than a string, because the stack also holds values
 * that came out of storage. A string sentinel is forgeable: a `children` array
 * holding `" "` — or any other string — would be read back as this marker and
 * emitted as text, so malformed stored data could put words into the output
 * instead of being skipped. Nothing in parsed JSON can equal a symbol.
 */
const BLOCK_BOUNDARY: unique symbol = Symbol("rich-text block boundary");

/**
 * The plain text inside a rich-text value, for anything that needs words rather
 * than formatting.
 *
 * SEO extraction and search indexing both want this, and both would otherwise
 * write their own walk — which is the second-reader problem this module exists
 * to avoid, in miniature.
 *
 * ## Separators go at block boundaries, never between text leaves
 *
 * Lexical splits a run of text at every change of formatting, so the word
 * `prefix` with only its second half bold is stored as two adjacent text nodes.
 * Joining leaves with a space turns that into `pre fix`, and `Hello` followed by
 * a bold comma into `Hello ,`. Adjacent leaves are therefore concatenated, and a
 * space is introduced only when leaving a block-level container or crossing a
 * line break — which is where the author put a boundary.
 *
 * "Block-level" is decided by the node's TYPE, not by whether it has children.
 * A node can carry its own `text` and still be drawn as a block — `button-link`
 * stores its label that way — and reading the label without the boundary runs
 * it into whatever follows: a passage of `Before`, a button reading `Buy now`,
 * then `After` flattens to `Before Buy nowAfter`, which is what a crawler would
 * then be handed as the page description.
 *
 * ## Iterative
 *
 * The walk uses an explicit stack rather than recursion. Nesting depth here is
 * bounded by what an editor produced, not by anything this package enforces:
 * the document limits count block nodes, not the objects inside a prop, so a
 * value well under the size cap can nest thousands of paragraphs deep. Recursion
 * would exhaust the call stack on it, and this helper is exported to SEO and
 * search paths where that would take down a request rather than a render.
 */
export function richTextToPlainText(value: RichTextValue): string {
  const parts: string[] = [];
  // A string on the stack is a separator to emit once the subtree that earned it
  // has been consumed; pushing it BEFORE that node's children is what places it
  // after them, since the stack pops in reverse.
  const stack: (RichTextNode | typeof BLOCK_BOUNDARY)[] = [];
  pushChildren(stack, value.root.children);

  while (stack.length > 0) {
    const item = stack.pop();
    if (item === undefined) continue;
    if (item === BLOCK_BOUNDARY) {
      parts.push(" ");
      continue;
    }
    if (!isRichTextNode(item)) continue;

    const leaf = leafText(item);
    if (leaf !== null) {
      // A leaf that is not inline still ENDS a block, so it earns the same
      // boundary a container would. Pushed rather than appended, so it lands
      // after this node the way the container case does.
      if (!isInline(item)) stack.push(BLOCK_BOUNDARY);
      parts.push(leaf);
      continue;
    }

    if (!isInline(item)) stack.push(BLOCK_BOUNDARY);
    if (Array.isArray(item.children)) pushChildren(stack, item.children);
  }

  return parts.join("").replace(/\s+/g, " ").trim();
}

/**
 * Pushes children so the stack pops them in document order.
 *
 * Reversed, because a stack returns what went on last. The `undefined` skip is
 * what a sparse array yields, which JSON cannot express but a caller building a
 * value by hand can.
 */
function pushChildren(
  stack: (RichTextNode | typeof BLOCK_BOUNDARY)[],
  nodes: readonly RichTextNode[]
): void {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const child = nodes[i];
    if (child !== undefined) stack.push(child);
  }
}

/**
 * The text this node contributes on its own, or `null` if it is a container to
 * descend into.
 *
 * A line break contributes a space: it is where the author ended a line, and
 * plain text has no other way to say so.
 */
/**
 * Whether a node sits INSIDE a line rather than ending one.
 *
 * Text and line breaks are the two the walk meets constantly and neither ends a
 * block: a run split by formatting must join up, and a break already emits its
 * own space. Everything else is decided by type.
 */
function isInline(node: RichTextNode): boolean {
  if (typeof node.text === "string" && node.type === "text") return true;
  if (node.type === "linebreak") return true;
  return INLINE_CONTAINERS.has(node.type);
}

function leafText(node: RichTextNode): string | null {
  if (typeof node.text === "string") return node.text;
  if (node.type === "linebreak") return " ";
  return null;
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
 * The three case formats occupy bits 8 through 10, above a gap left by the
 * inline formats. They are transforms of how existing text is drawn rather than
 * elements wrapped around it, which is why a reader renders them as a style and
 * not as a tag.
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
  LOWERCASE: 256,
  UPPERCASE: 512,
  CAPITALIZE: 1024,
} as const;

/** Whether a node's format bitfield carries one particular format. */
export function hasFormat(
  format: number | undefined,
  flag: (typeof TEXT_FORMAT)[keyof typeof TEXT_FORMAT]
): boolean {
  return ((format ?? 0) & flag) !== 0;
}

/**
 * Token types the code tokenizer emits, as a class-name fragment.
 *
 * Checked rather than trusted: the value arrives from stored content and is
 * written into a class attribute, where a crafted string could otherwise close
 * the attribute and inject markup in a serializer that builds HTML by hand.
 */
const SAFE_HIGHLIGHT_TYPE = /^[a-z][a-z0-9-]*$/;

/**
 * The class a syntax-highlighted code token carries, or `undefined` for a token
 * whose type is missing or unusable.
 *
 * Shared for the same reason the format bits are: the CMS builds an HTML string
 * and the renderer builds a React element, but WHICH class a token gets is one
 * question, and two answers to it means code highlighted on one surface and
 * bare on the other with nothing raised on either. A token with no usable type
 * is emitted unwrapped rather than given an element that would say nothing.
 */
export function codeTokenClass(highlightType: unknown): string | undefined {
  if (typeof highlightType !== "string") return undefined;
  if (!SAFE_HIGHLIGHT_TYPE.test(highlightType)) return undefined;
  return `nextly-code-token nextly-code-token--${highlightType}`;
}
