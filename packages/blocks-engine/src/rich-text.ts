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
import { authoredText } from "./authored-text";
import { isLinkableUrl } from "./url-policy";

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

    /*
     * Asked ONCE, before the node is read, because it is the same question
     * either way: does this node end a line?
     *
     * BOTH sides, and the leading one is not decoration. Lexical's decorator
     * nodes are inline unless a node overrides `isInline()`, and none of this
     * editor's do — so inserting a button with the caret in a paragraph makes
     * it a CHILD of that paragraph, between two text runs. A trailing boundary
     * alone leaves `Before`, a button reading `Buy now`, then `After` as
     * `BeforeBuy now After`: separated from what follows and welded to what
     * came before.
     *
     * Redundant spaces cost nothing — the join collapses runs of whitespace —
     * so this does not need to know whether a boundary already sits there.
     */
    const inline = isInline(item);
    if (!inline) {
      parts.push(" ");
      stack.push(BLOCK_BOUNDARY);
    }

    const leaf = leafText(item);
    if (leaf !== null) {
      parts.push(leaf);
      continue;
    }
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
 * Leaves that carry their own text and are still drawn as BLOCKS.
 *
 * Named explicitly, and short on purpose. Carrying `text` is the norm for
 * inline content and the exception for block content, so a type nobody has
 * listed here keeps the behaviour it already had — which is what an unknown
 * type from a future editor should get.
 */
const BLOCK_LEVEL_LEAVES: ReadonlySet<string> = new Set(["button-link"]);

/**
 * Whether a node sits INSIDE a line rather than ending one.
 *
 * A line break is inline because it already emits its own space. Beyond that
 * the question splits on whether the node carries its own text:
 *
 * - It does: inline unless listed above. Deciding this by `type === "text"`
 *   instead is too coarse and measurably wrong — `code-highlight` carries text
 *   for every syntax token in a code block, so `foo(bar)` would flatten to
 *   `foo ( bar )`. A run split by formatting has the same problem: `pre` plus
 *   bold `fix` must not read as `pre fix`.
 * - It does not: it is a container, and only a link stays inside the line.
 */
function isInline(node: RichTextNode): boolean {
  if (node.type === "linebreak") return true;
  if (typeof node.text === "string") return !BLOCK_LEVEL_LEAVES.has(node.type);
  return INLINE_CONTAINERS.has(node.type);
}

/**
 * Labels a node keeps in a LIST of its own rather than in `text`.
 *
 * `button-group` stores each button under `buttons[].text`, and the renderer
 * draws every one of them. A walk that reads only `text` and `children` sees
 * neither, so a passage of "Choose", a group offering "Basic" and "Pro", then
 * "today" flattens to "Choose today" — words the page shows, missing from the
 * description of it.
 *
 * Projected here rather than at the consumer, so SEO, search indexing and
 * anything else reading this walk describe the same page.
 */
function listedLabels(node: RichTextNode): string | null {
  if (node.type !== "button-group" || !Array.isArray(node.buttons)) return null;
  const labels = node.buttons.flatMap(button => {
    const label = labelOf(button);
    return label === null ? [] : [label];
  });
  return labels.length > 0 ? labels.join(" ") : null;
}

/**
 * The label a serialized list ITEM carries, or `null` if it has none.
 *
 * Asked of the shape rather than of a node type, because these items are not
 * nodes: a button in a group serializes as `{ url, text, variant, size }` with
 * no `type` at all. A check written against the node guard rejects every real
 * one, and a fixture that invents a `type` to get past it tests nothing.
 *
 * Empty labels are dropped rather than joined, so a button whose text was never
 * filled in does not open a gap in the middle of a sentence.
 */
function labelOf(item: unknown): string | null {
  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    return null;
  }
  const fields = item as { text?: unknown; url?: unknown };
  // Only what a reader would actually SHOW. A button whose URL this format
  // cannot express is not drawn, so reporting its label would describe a page
  // by a word that never appears on it — the mirror of the defect that made
  // these labels worth reading in the first place.
  if (!isLinkableUrl(fields.url)) return null;
  // Through the SAME projection the renderer draws with, not a `typeof` test of
  // its own. A stored number is authored text there, so a button whose label is
  // `0` shows the character "0" on the page; a string-only check here described
  // that page by a label it does not carry.
  const text = authoredText(fields.text);
  return text.length > 0 ? text : null;
}

function leafText(node: RichTextNode): string | null {
  /*
   * A block-level leaf carries a LABEL, not text, even though it stores it
   * under the same key — so it is asked first and asked through `labelOf`.
   *
   * Reading `node.text` for it instead gets two things wrong at once, and both
   * disagree with what the reader draws. A label stored as a number is drawn
   * and would be skipped here; and a button whose URL this format cannot
   * express is NOT drawn, yet its label would be reported. `labelOf` is the
   * decision the group items already go through, and a standalone button is
   * the same button with nothing beside it.
   */
  if (BLOCK_LEVEL_LEAVES.has(node.type)) return labelOf(node);
  if (typeof node.text === "string") return node.text;
  if (node.type === "linebreak") return " ";
  return listedLabels(node);
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

/**
 * The schema option that restricts a prop's rich value to ONE paragraph of
 * words with bold, italic, links and line breaks.
 *
 * A block declares it beside the prop's type, as `core/text` does:
 * `{ type: "textarea", oneParagraph: true }`. The TYPE stays the one a line of
 * words has, because that is what the value is to everything that is not an
 * editor or a renderer: a binding fills it from a text field and never from a
 * rich-text one, a component exposes it as text, and a placement's value for it
 * is a string. The option is what tells an editor and a renderer that the
 * value may also carry the three marks, and that they must restrict it.
 *
 * Here rather than in each reader because two ends must mean the same thing by
 * it: the block library writes it into a schema, and the builder reads it to
 * decide which editor the value is handed to.
 */
export const ONE_PARAGRAPH_OPTION = "oneParagraph";

/**
 * Whether a prop's schema declares the one-paragraph restriction.
 *
 * Takes any record, not the engine's prop schema, so a reader holding a schema
 * from anywhere asks the same question; only an explicit `true` counts.
 */
export function isOneParagraphProp(
  schema: Readonly<Record<string, unknown>> | undefined
): boolean {
  return schema !== undefined && schema[ONE_PARAGRAPH_OPTION] === true;
}

/** The format bits a one-paragraph value keeps: bold and italic. */
const ONE_PARAGRAPH_FORMATS = TEXT_FORMAT.BOLD | TEXT_FORMAT.ITALIC;

/**
 * How many nodes one restriction visits at most.
 *
 * A stored value has no size of its own beyond the document's byte cap, and a
 * value well under it can nest thousands of containers deep. Past this the
 * restriction keeps what it has read and says it dropped the rest.
 */
const MAX_ONE_PARAGRAPH_VISITS = 50_000;

/** One piece of a restricted paragraph, before adjacent runs are joined. */
type ParagraphPiece =
  | { readonly kind: "text"; readonly text: string; readonly format: number }
  | { readonly kind: "break" }
  | {
      readonly kind: "link";
      readonly url: string;
      readonly target?: "_blank";
      readonly rel?: string;
      readonly runs: readonly ParagraphPiece[];
    };

/** What restricting a value produced. */
export interface OneParagraph {
  /** The value as one paragraph: what is stored, and what is drawn. */
  readonly value: RichTextValue;
  /**
   * Whether anything beyond the words was left out: a second paragraph, a
   * heading, a list, a quote, a mark other than bold or italic, an inline
   * style, a link this format cannot hold, or anything else.
   *
   * False for words alone, a string with line breaks, and a value that was
   * already one paragraph of the three marks. An editor reads it to tell the
   * author that a paste lost its formatting.
   */
  readonly dropped: boolean;
}

/**
 * A `rel` kept only as space-separated lowercase words, so whatever a paste or
 * an import left there reaches the renderer as link relations and nothing
 * else. The renderer adds `noopener noreferrer` to a new-tab link either way.
 */
const SAFE_REL = /^[a-z]+(?: [a-z]+)*$/;

/** Mutable state of one restriction walk. */
interface RestrictWalk {
  visits: number;
  dropped: boolean;
  /** Whether the walk has already put words in, for the line between blocks. */
  wrote: boolean;
}

/** A text leaf's words as pieces: its runs, with `\n` read as line breaks. */
function textPieces(text: string, format: number): ParagraphPiece[] {
  const pieces: ParagraphPiece[] = [];
  const lines = text.split(/\r\n|\r|\n/);
  lines.forEach((line, index) => {
    if (index > 0) pieces.push({ kind: "break" });
    if (line !== "") pieces.push({ kind: "text", text: line, format });
  });
  return pieces;
}

/** A link node's address and attributes as the restriction keeps them. */
function linkParts(
  node: RichTextNode
): Omit<Extract<ParagraphPiece, { kind: "link" }>, "kind" | "runs"> | null {
  if (!isLinkableUrl(node.url)) return null;
  const url = (node.url as string).trim();
  const rel =
    typeof node.rel === "string" && SAFE_REL.test(node.rel.trim())
      ? node.rel.trim()
      : undefined;
  return {
    url,
    ...(node.target === "_blank" ? { target: "_blank" as const } : {}),
    ...(rel === undefined ? {} : { rel }),
  };
}

/** Whether the walk has spent its budget, which drops what is left. */
function spent(walk: RestrictWalk): boolean {
  if (walk.visits < MAX_ONE_PARAGRAPH_VISITS) return false;
  walk.dropped = true;
  return true;
}

/** A text leaf's pieces: its words, with only bold and italic kept. */
function textLeafPieces(
  node: RichTextNode,
  walk: RestrictWalk
): ParagraphPiece[] {
  const format = typeof node.format === "number" ? node.format : 0;
  const kept = format & ONE_PARAGRAPH_FORMATS;
  const styled = typeof node.style === "string" && node.style.trim() !== "";
  if (kept !== format || styled) walk.dropped = true;
  return textPieces(node.text as string, kept);
}

/**
 * A link's pieces: a link around its runs when its address is one this
 * format can hold, and its runs alone otherwise. Its runs are walked with
 * links flattened, which is one level of walk however deep links nest.
 */
function linkPieces(node: RichTextNode, walk: RestrictWalk): ParagraphPiece[] {
  const parts = linkParts(node);
  const runs = inlinePieces(kidsOf(node), walk, true);
  if (parts === null) {
    walk.dropped = true;
    return runs;
  }
  return runs.length > 0 ? [{ kind: "link", ...parts, runs }] : [];
}

/**
 * A link's pieces, or, inside another link, only its words: read on this
 * walk's own stack rather than by a walk of its own, so links nested any
 * depth cannot run the call stack out.
 */
function linkOrWords(
  node: RichTextNode,
  walk: RestrictWalk,
  inLink: boolean,
  stack: unknown[]
): ParagraphPiece[] {
  if (!inLink) return linkPieces(node, walk);
  walk.dropped = true;
  pushReversed(stack, kidsOf(node));
  return [];
}

/**
 * The pieces one node contributes in a line. A node this format does not
 * hold keeps only its words: a label or a code token's text as plain words,
 * and a container's children, which go on `stack` to be read in turn.
 */
function nodePieces(
  node: unknown,
  walk: RestrictWalk,
  inLink: boolean,
  stack: unknown[]
): ParagraphPiece[] {
  if (!isRichTextNode(node)) {
    walk.dropped = true;
    return [];
  }
  if (node.type === "text" && typeof node.text === "string") {
    return textLeafPieces(node, walk);
  }
  if (node.type === "linebreak") return [{ kind: "break" }];
  if (node.type === "link" || node.type === "autolink") {
    return linkOrWords(node, walk, inLink, stack);
  }
  walk.dropped = true;
  if (typeof node.text === "string") return textPieces(node.text, 0);
  pushReversed(stack, kidsOf(node));
  return [];
}

/**
 * Adds pieces one by one rather than spread into one call: a single text leaf
 * can expand to any number of pieces, more than a call takes as arguments.
 */
function appendAll(
  out: ParagraphPiece[],
  pieces: readonly ParagraphPiece[]
): void {
  for (const piece of pieces) out.push(piece);
}

/** Puts nodes on a walk's stack so they pop in their order. */
function pushReversed(stack: unknown[], nodes: readonly unknown[]): void {
  for (let i = nodes.length - 1; i >= 0; i--) stack.push(nodes[i]);
}

/**
 * The inline pieces of a list of nodes, read in document order within the
 * walk's budget. `inLink` flattens a link inside a link to its words, since an
 * anchor cannot hold another.
 */
function inlinePieces(
  nodes: readonly unknown[],
  walk: RestrictWalk,
  inLink: boolean
): ParagraphPiece[] {
  const out: ParagraphPiece[] = [];
  const stack: unknown[] = [];
  pushReversed(stack, nodes);
  while (stack.length > 0 && !spent(walk)) {
    walk.visits += 1;
    appendAll(out, nodePieces(stack.pop(), walk, inLink, stack));
  }
  return out;
}

/** A node's children as a list, whatever storage left there. */
function kidsOf(node: RichTextNode): readonly unknown[] {
  return Array.isArray(node.children) ? node.children : [];
}

/** Whether a node is a block that holds others: a paragraph, a list, an item. */
function isBlockContainer(node: unknown): boolean {
  return (
    isRichTextNode(node) &&
    Array.isArray(node.children) &&
    !INLINE_CONTAINERS.has(node.type)
  );
}

/**
 * A list of nodes as blocks: each block as it is, and each run of inline nodes
 * between them wrapped as one paragraph of its own, so words that sit beside a
 * nested list, or straight under the root, are read as a line of their own.
 */
function asBlocks(nodes: readonly unknown[]): unknown[] {
  const blocks: unknown[] = [];
  let run: unknown[] = [];
  const flush = (): void => {
    if (run.length > 0) blocks.push({ type: "paragraph", children: run });
    run = [];
  };
  for (const node of nodes) {
    if (isBlockContainer(node)) {
      flush();
      blocks.push(node);
    } else {
      run.push(node);
    }
  }
  flush();
  return blocks;
}

/**
 * One block's part of the walk: its blocks pushed to be read in turn when it
 * holds any (a list, a quote, a table), or its words added on a line of
 * their own.
 */
function readBlock(
  block: unknown,
  walk: RestrictWalk,
  stack: unknown[],
  out: ParagraphPiece[]
): void {
  if (!isRichTextNode(block)) {
    walk.dropped = true;
    return;
  }
  if (block.type !== "paragraph") walk.dropped = true;
  const kids = kidsOf(block);
  if (kids.some(isBlockContainer)) {
    walk.dropped = true;
    pushReversed(stack, asBlocks(kids));
    return;
  }
  const pieces = inlinePieces(kids, walk, false);
  if (pieces.length === 0) return;
  if (walk.wrote) out.push({ kind: "break" });
  appendAll(out, pieces);
  walk.wrote = true;
}

/**
 * The words of every block in a value, one block after another, with a line
 * break where one block ended and the next began.
 */
function blockPieces(
  nodes: readonly unknown[],
  walk: RestrictWalk
): ParagraphPiece[] {
  const out: ParagraphPiece[] = [];
  const top = asBlocks(nodes);
  // More than one block is more than one paragraph, whatever each holds.
  if (top.length > 1) walk.dropped = true;
  const stack: unknown[] = [];
  pushReversed(stack, top);
  while (stack.length > 0 && !spent(walk)) {
    walk.visits += 1;
    readBlock(stack.pop(), walk, stack, out);
  }
  return out;
}

/** A link piece as a stored node, or `null` when it holds no words. */
function linkNode(
  piece: Extract<ParagraphPiece, { kind: "link" }>
): RichTextNode | null {
  const children = paragraphNodes(piece.runs);
  if (children.length === 0) return null;
  return {
    type: "link",
    url: piece.url,
    ...(piece.target === undefined ? {} : { target: piece.target }),
    ...(piece.rel === undefined ? {} : { rel: piece.rel }),
    children,
  };
}

/** Adds words to a run of nodes, joined to the last when it has their format. */
function appendWords(
  nodes: RichTextNode[],
  piece: Extract<ParagraphPiece, { kind: "text" }>
): void {
  const last = nodes.at(-1);
  if (last?.type === "text" && last.format === piece.format) {
    last.text = `${String(last.text)}${piece.text}`;
    return;
  }
  nodes.push({ type: "text", text: piece.text, format: piece.format });
}

/**
 * The stored nodes for a run of pieces, with adjacent words of one format
 * joined, so one value has one stored form whichever editor produced it.
 */
function paragraphNodes(pieces: readonly ParagraphPiece[]): RichTextNode[] {
  const nodes: RichTextNode[] = [];
  for (const piece of pieces) {
    if (piece.kind === "text") {
      appendWords(nodes, piece);
      continue;
    }
    const node =
      piece.kind === "break" ? { type: "linebreak" } : linkNode(piece);
    if (node !== null) nodes.push(node);
  }
  return nodes;
}

/** One paragraph holding these nodes, as a whole value. */
function paragraphValue(children: RichTextNode[]): RichTextValue {
  return {
    root: { type: "root", children: [{ type: "paragraph", children }] },
  };
}

/**
 * A stored value as ONE paragraph of words with bold, italic, links and line
 * breaks, and whether anything else was left out.
 *
 * The one restriction for every reader and writer of such a value: the editor
 * restricts what it writes, the renderer restricts what it draws, and the
 * upgrade of an older string goes through it too, so a value that holds a
 * heading — written by an older editor, an import or a hand-edited row — is
 * drawn and saved as its words rather than as a heading.
 *
 * Anything that is not rich text is read as authored text: a string (or a
 * stored number) becomes the paragraph, each `\n` a line break, which is how a
 * Text saved as plain words reads. Rich text keeps its words, in order; each
 * block after the first starts a new line. A link keeps its address only when
 * it is one this format can express ({@link isLinkableUrl}: never
 * `javascript:`), its target only when it is a new tab, and its `rel` only as
 * plain words; any other link keeps its words without the link.
 *
 * Total and pure: whatever the input, the answer is a value every reader can
 * walk, built fresh, sharing nothing with the input.
 */
export function toOneParagraph(value: unknown): OneParagraph {
  if (!isRichTextValue(value)) {
    return {
      value: paragraphValue(paragraphNodes(textPieces(authoredText(value), 0))),
      dropped: false,
    };
  }
  const walk: RestrictWalk = { visits: 0, dropped: false, wrote: false };
  const pieces = blockPieces(value.root.children, walk);
  return {
    value: paragraphValue(paragraphNodes(pieces)),
    dropped: walk.dropped,
  };
}

/**
 * The words of a one-paragraph value, with its marks left out and each line
 * break read as a space: what a description, a summary or a note quoting the
 * value says.
 *
 * Takes anything a document may hold there, an older string included, through
 * {@link toOneParagraph}, so every reader of a Text's words reads the same
 * words the page draws.
 */
export function oneParagraphWords(value: unknown): string {
  return richTextToPlainText(toOneParagraph(value).value);
}

/**
 * The words of a one-paragraph value with its lines kept: every run, a
 * link's included, and `\n` for each line break, with the marks left out.
 *
 * What a plain-text field edits a Text's words as, where the value is held as
 * a string with its lines (a component placement's override): reading it
 * back through {@link toOneParagraph} gives the same lines, so editing one
 * word keeps the breaks. {@link oneParagraphWords} is for a summary, and
 * folds the lines into spaces.
 */
export function oneParagraphLines(value: unknown): string {
  const first = toOneParagraph(value).value.root.children[0];
  const parts: string[] = [];
  const stack: unknown[] = [];
  pushReversed(stack, first === undefined ? [] : kidsOf(first));
  while (stack.length > 0) {
    const node = stack.pop();
    if (!isRichTextNode(node)) continue;
    if (node.type === "linebreak") parts.push("\n");
    else if (typeof node.text === "string") parts.push(node.text);
    else pushReversed(stack, kidsOf(node));
  }
  return parts.join("");
}
