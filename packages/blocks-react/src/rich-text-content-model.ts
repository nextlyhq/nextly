/**
 * What rich text's nodes may hold, as HTML decides it: which nodes draw an
 * interactive element or block content, and the partition that moves block
 * content out of a container that may hold only phrasing content.
 *
 * @module rich-text-content-model
 */
import { isRichTextNode, type RichTextNode } from "@nextlyhq/blocks-engine";

import { url } from "./blocks/props";
import { isRenderable } from "./rich-text-buttons";

/**
 * The types this renderer draws as something a `<p>` may not contain.
 *
 * Lexical's `DecoratorNode` is INLINE unless a node overrides `isInline()`, and
 * at lexical 0.47.0 not one of this editor's five decorator nodes does — image,
 * gallery, video, button-link and button-group are all inline, so inserting one
 * with a caret in a paragraph makes it a CHILD of that paragraph. Drawing a
 * `<figure>`, a `<ul>` or a flex row inside `<p>` then publishes markup a
 * browser will not parse as written: `<p>` is closed at any of them, so the DOM
 * that results is not the tree React rendered, and every page carrying one
 * hydrates mismatched.
 *
 * Naming the BLOCK types rather than the phrasing ones is deliberate. A type no
 * list here has heard of is drawn by the unknown-node fallback, which emits no
 * element of its own, so phrasing is the correct answer for it.
 *
 * A LIST rather than a set literal, because the admin's conformance test reads
 * it with the same `constMembers` it already uses for the button vocabularies,
 * and holds every dispatch key to being classified here or declared phrasing
 * there. A new decorator added to {@link NODE_VIEWS} and forgotten here fails
 * that check instead of silently publishing a `<figure>` inside a `<p>`.
 */
const BLOCK_LEVEL_NODES = [
  "paragraph",
  "heading",
  "quote",
  "list",
  "listitem",
  "code",
  "horizontalrule",
  "table",
  "tablerow",
  "tablecell",
  "collapsible-container",
  "collapsible-title",
  "collapsible-content",
  "image",
  "gallery",
  "button-link",
  "button-group",
] as const;

/**
 * Types this renderer draws as their OWN interactive element.
 *
 * An `<a>` may not contain another `<a>`, and the parser does not merely object:
 * it closes the outer anchor at the inner one, lifts the content out, and
 * inserts a DUPLICATE empty anchor inside — measured, so a link applied across a
 * button produced markup with two anchors React never rendered.
 */
const INTERACTIVE_NODES: ReadonlySet<string> = new Set([
  "link",
  "autolink",
  "button-link",
  "button-group",
]);

/** Whether anything drawn inside a container is itself interactive. */
// Exported for its depth test only: the package entries export `RichText`
// alone, so this is not published.
export function holdsInteractive(
  nodes: readonly RichTextNode[] | undefined
): boolean {
  return anyDescendant(nodes, node => INTERACTIVE_NODES.has(node.type));
}

/**
 * Whether this passage DRAWS an interactive element: a link whose destination
 * survives `url()`, or a button the row would render. Asked with the same
 * decisions the views make, so a link the renderer turns back into text
 * makes nothing interactive. What a block's content model reads; the anchor
 * nesting guard above keeps the coarser type scan.
 */
export function drawsInteractive(
  nodes: readonly RichTextNode[] | undefined
): boolean {
  return anyDescendant(nodes, node => {
    switch (node.type) {
      case "link":
      case "autolink":
        return url(node.url) !== undefined;
      case "button-link":
        return isRenderable(node);
      case "button-group":
        return (
          Array.isArray(node.buttons) &&
          node.buttons.some(
            entry =>
              entry !== null &&
              typeof entry === "object" &&
              isRenderable(entry as Readonly<Record<string, unknown>>)
          )
        );
      default:
        return false;
    }
  });
}

/**
 * Whether any node in this subtree satisfies a test.
 *
 * ITERATIVE, with an explicit stack, and that is load-bearing rather than a
 * style choice. Nesting here is bounded by what an editor or an import
 * produced, not by anything the document limits enforce: those count BLOCK
 * nodes, and this is the tree inside one prop. A value far below the byte cap
 * can nest thousands of levels deep, and a recursive scan over it exhausts the
 * call stack — which throws while rendering rather than returning an answer,
 * taking the whole page route down instead of degrading to a placeholder.
 *
 * Measured on this renderer: about five thousand nested containers that neither
 * scan short-circuits on is enough. The engine's own plain-text walk is
 * iterative for exactly this reason and says so; these scans are reached from
 * the same values and had not followed.
 *
 * A node that MATCHES ends the walk, and a node whose children are not an array
 * simply contributes none — both preserve what the recursive form answered.
 */
function anyDescendant(
  nodes: readonly RichTextNode[] | undefined,
  matches: (node: RichTextNode) => boolean
): boolean {
  // Array-checked for the reason {@link children} gives: this is stored JSON.
  if (!Array.isArray(nodes)) return false;
  const stack: RichTextNode[] = [];
  pushAll(stack, nodes);
  while (stack.length > 0) {
    const child = stack.pop();
    if (child === undefined || !isRichTextNode(child)) continue;
    if (matches(child)) return true;
    if (Array.isArray(child.children)) pushAll(stack, child.children);
  }
  return false;
}

/**
 * Pushes nodes onto a walk stack.
 *
 * One at a time rather than by spreading, because a spread passes every element
 * as an argument and a stored array large enough would exceed the call's own
 * argument limit — trading one stack overflow for another.
 */
function pushAll(stack: RichTextNode[], nodes: readonly RichTextNode[]): void {
  for (const node of nodes) if (node !== undefined) stack.push(node);
}

const BLOCK_LEVEL: ReadonlySet<string> = new Set(BLOCK_LEVEL_NODES);

/**
 * Whether anything drawn inside a container lands as block content.
 *
 * DESCENDS through nodes that are not themselves block, rather than reading the
 * immediate children alone. Applying a link across a selection that contains an
 * image serialises as `link -> image`, and a shallow check sees only the
 * phrasing `link` while {@link LinkView} goes on to draw `<a><figure>` — inside
 * the `<p>` the shallow answer preserved. The unknown-node fallback needs the
 * same treatment for the opposite reason: it emits no element at all, so its
 * children land in whatever encloses IT.
 *
 * A block node ends the walk instead of being descended into, because it has
 * already answered the question.
 */
// Exported for its depth test only: the package entries export `RichText`
// alone, so this is not published.
export function holdsBlockContent(
  nodes: readonly RichTextNode[] | undefined
): boolean {
  return anyDescendant(nodes, node => BLOCK_LEVEL.has(node.type));
}

/**
 * What a `summary` may hold besides phrasing content.
 *
 * The HTML content model is phrasing content, optionally intermixed with heading
 * content — so a stored or imported `collapsible-title -> heading` is LEGAL, and
 * moving it out takes the disclosure's only label with it.
 */
export const SUMMARY_PERMITS: ReadonlySet<string> = new Set(["heading"]);

/** A heading admits no block content of any kind, a nested heading included. */
export const PERMITS_NOTHING: ReadonlySet<string> = new Set<string>();

/** A node's children, as the array the rest of this file can rely on. */
export function kidsOf(node: RichTextNode): readonly RichTextNode[] {
  return Array.isArray(node.children) ? node.children : [];
}

/**
 * How deep this partition will descend before it stops rearranging.
 *
 * The walk REBUILDS the tree as it goes — each level returns wrappers holding
 * the children that stayed and the children that moved — so unlike the scans it
 * cannot be flattened into a stack without changing what it produces. It is
 * therefore bounded instead.
 *
 * Beyond the bound the node is kept where it is rather than partitioned. That
 * yields markup this function would otherwise have corrected, in a passage
 * nested a hundred wrappers deep inside one heading — a shape no editor
 * produces and no author writes. The alternative is `RangeError` thrown out of
 * the render, which takes the page route down rather than one passage's layout,
 * and nothing bounds this depth from outside: the document limits count block
 * nodes, not the tree inside a prop.
 *
 * A hundred is far above any authored nesting and far below the call stack.
 */
// Exported for its test only: the package entries export `RichText` alone.
export const MAX_PARTITION_DEPTH = 100;

/**
 * Where ONE child of a phrasing-only container belongs.
 *
 * Answered per child so the walk above stays a walk: the decision has five
 * cases and the sequencing rule has its own, and reading them interleaved is
 * how a case comes to be judged against the wrong container.
 *
 * See {@link PhrasingOnly} for why each branch answers the way it does.
 */
function partitionChild(
  child: RichTextNode,
  permits: ReadonlySet<string>,
  depth: number
): { keeps: RichTextNode[]; moves: RichTextNode[] } {
  if (!isRichTextNode(child)) return { keeps: [child], moves: [] };
  if (permits.has(child.type)) {
    // Kept, but its OWN block content still may not live here. Moved out
    // unwrapped: a second copy of this heading would be a second outline entry.
    const inner = partitionPhrasing(kidsOf(child), PERMITS_NOTHING, depth + 1);
    return { keeps: [{ ...child, children: inner.keeps }], moves: inner.moves };
  }
  if (BLOCK_LEVEL.has(child.type)) return { keeps: [], moves: [child] };
  // Kept whole past the bound: rearranging it is what would recurse.
  if (depth >= MAX_PARTITION_DEPTH || !holdsBlockContent(child.children))
    return { keeps: [child], moves: [] };
  // An inline wrapper holding both. Split it, keeping the wrapper on each side
  // so the words stay linked and the media stays linked.
  const inner = partitionPhrasing(kidsOf(child), permits, depth + 1);
  return {
    keeps: inner.keeps.length > 0 ? [{ ...child, children: inner.keeps }] : [],
    moves: rewrapMoved(child, inner.moves),
  };
}

/**
 * A moved run back inside its inline wrapper, split where the wrapper cannot
 * hold what it would contain.
 *
 * ONE copy around the whole run is the obvious shape and it silently drops the
 * author's link. A link may not contain another interactive element, so
 * {@link LinkView} renders such a wrapper as its children alone — and a single
 * button in the middle of the run therefore unwraps the phrasing AFTER it too,
 * which the author had linked and which nothing else in the run objects to. The
 * same passage with an image in place of the button keeps its trailing link,
 * so the two spellings of one document disagreed.
 *
 * Segmenting instead: each run of nodes the wrapper may legally hold gets its
 * OWN copy, and a node it may not hold is emitted beside them, unwrapped. Order
 * is preserved throughout, which is the property the move exists to protect.
 *
 * Only an interactive wrapper is at risk. Any other inline wrapper — a format
 * span, a mark — has no such rule against its contents and is copied whole,
 * because splitting it would fragment a run for no gain.
 */
function rewrapMoved(
  wrapper: RichTextNode,
  moved: readonly RichTextNode[]
): RichTextNode[] {
  if (moved.length === 0) return [];
  if (!INTERACTIVE_NODES.has(wrapper.type))
    return [{ ...wrapper, children: [...moved] }];

  const out: RichTextNode[] = [];
  let run: RichTextNode[] = [];
  const closeRun = () => {
    if (run.length === 0) return;
    out.push({ ...wrapper, children: run });
    run = [];
  };
  for (const node of moved) {
    // The node itself as well as its descendants: the wrapper is taken apart by
    // an interactive element at any depth inside it, not only a direct child.
    if (holdsInteractive([node])) {
      closeRun();
      out.push(node);
      continue;
    }
    run.push(node);
  }
  closeRun();
  return out;
}

/**
 * Children split into what a phrasing-only container keeps and what follows it.
 *
 * See {@link PhrasingOnly} for why each branch answers the way it does.
 */
// Exported for its depth test only: the package entries export `RichText`
// alone, so this is not published.
export function partitionPhrasing(
  nodes: readonly RichTextNode[],
  permits: ReadonlySet<string>,
  depth = 0
): { keeps: RichTextNode[]; moves: RichTextNode[] } {
  const keeps: RichTextNode[] = [];
  const moves: RichTextNode[] = [];
  for (const child of nodes) {
    /*
     * Once anything has moved out, everything after it goes with it.
     *
     * The container's phrasing is not a SET to be gathered; it is a sequence
     * the author wrote. Collecting every phrasing child regardless of position
     * reorders the passage — `Before`, an image, `After` renders as one heading
     * reading "BeforeAfter" followed by the image, which has walked backwards
     * past text that came after it.
     *
     * Following the block out rather than splitting the container around it,
     * because a second copy of the tag is a second entry in the document
     * outline — the same reason a permitted heading's own block content leaves
     * unwrapped. Trailing phrasing lands in the flow after the container, where
     * phrasing content is legal, and in the author's order.
     */
    if (moves.length > 0) {
      moves.push(child);
      continue;
    }
    const placed = partitionChild(child, permits, depth);
    // One at a time: a spread passes every element as an argument, and a stored
    // passage large enough exceeds the call's own argument limit.
    pushAll(keeps, placed.keeps);
    pushAll(moves, placed.moves);
  }
  return { keeps, moves };
}
