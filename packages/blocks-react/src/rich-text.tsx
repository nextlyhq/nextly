import {
  codeTokenClass,
  isRichTextNode,
  isRichTextValue,
  type RichTextNode,
} from "@nextlyhq/blocks-engine";
import type { ReactNode } from "react";

import {
  anchorAllocator,
  anchorIds,
  headingRank,
  type HeadingAnchor,
} from "./blocks/heading-anchors";
import { relFor, url } from "./blocks/props";
import type { BlockHostPolicy } from "./context";
import { ButtonLinkView, ButtonGroupView } from "./rich-text-buttons";
import {
  holdsInteractive,
  holdsBlockContent,
  SUMMARY_PERMITS,
  PERMITS_NOTHING,
  kidsOf,
  partitionPhrasing,
} from "./rich-text-content-model";
import type {
  DrawSettings,
  DrawnParts,
  PartsReader,
} from "./rich-text-draw-settings";
import { formatted } from "./rich-text-formats";
import { ImageView, GalleryView } from "./rich-text-media";

/**
 * Drawing stored rich text as React.
 *
 * The CMS derives HTML from the same stored shape for its API consumers; this
 * draws a React tree for a page. Both read the type and the format bits from
 * `blocks-engine`, which is the only thing they can share — this package's
 * layering test forbids it from importing the CMS, the admin or the plugin SDK,
 * so there is no module a common READER could live in.
 *
 * That is a real cost and it is worth naming: two producers must agree about
 * what a node means. What contains it is that neither invents the meaning —
 * `TEXT_FORMAT` and `RichTextNode` are imported, never re-declared, so the
 * disagreement can only be about output and never about the data.
 *
 * ## No `dangerouslySetInnerHTML`
 *
 * Nodes become elements. Rich text arrives from storage, and storage holds
 * whatever an editor once accepted — passing it through an HTML string would
 * make every stored document a place markup could execute from, which is a
 * surface this format does not otherwise have.
 *
 * A stored URL is the one field where that is not enough. It reaches an `href`
 * attribute, where a `javascript:` or `data:text/html` value executes without
 * any markup being parsed at all, so it goes through the same `url()` boundary
 * every other stored URL in this package crosses.
 *
 * ## Unknown nodes render their children
 *
 * A site can register node types this renderer has never heard of. Dropping an
 * unknown node would silently delete an author's content; refusing to render
 * would take the page down for one unrecognised paragraph. Descending into its
 * children keeps the words and loses only the wrapper, which is the forgiving
 * behaviour the format asks for everywhere else.
 *
 * That fallback carries content only for nodes that HAVE children. The editor
 * also registers leaf nodes that hold their content in their own fields —
 * `image`, `video`, `gallery` and the button nodes — and those render as nothing
 * here. Each needs a URL and host policy of the kind the media blocks already
 * carry, so they are drawn by that work rather than guessed at here.
 *
 * @module rich-text
 */

export {
  holdsInteractive,
  drawsInteractive,
  holdsBlockContent,
  MAX_PARTITION_DEPTH,
  partitionPhrasing,
} from "./rich-text-content-model";

function children(
  nodes: readonly RichTextNode[] | undefined,
  draw: DrawSettings
): ReactNode {
  // Array-checked, not undefined-checked. `children` is stored JSON like
  // everything else here, so it can arrive as `{}` or `"oops"`, and calling
  // `.map` on either throws while rendering a published page. The type cannot
  // prevent it; only reading the value can.
  if (!Array.isArray(nodes)) return null;
  return nodes.map((node, i) => (
    // Index keys, and the reason is that nothing better exists: a serialized
    // node carries no identity, and a rich-text tree is replaced wholesale on
    // every edit rather than reordered in place, so React never has to match a
    // node across renders.
    <RichTextNodeView key={i} node={node} draw={draw} />
  ));
}

/**
 * Node types that are just an element around their children.
 *
 * A table rather than cases, because every one of them says the same thing and
 * a switch makes ten identical branches look like ten decisions. What is left
 * in {@link RichTextNodeView} is only the nodes that genuinely differ.
 */
const SIMPLE_ELEMENTS: Readonly<
  Record<
    string,
    "p" | "blockquote" | "li" | "details" | "summary" | "div" | "tbody" | "tr"
  >
> = {
  paragraph: "p",
  quote: "blockquote",
  listitem: "li",
  "collapsible-content": "div",
  tablerow: "tr",
};

/** How the views that draw children draw them. */
type ChildrenDrawn = "inside" | "heading" | "summary";

/**
 * The views in {@link NODE_VIEWS} that draw their node's children, and how.
 *
 * Every other view draws none: its content is in its own fields (an image, a
 * button) or it has none (a rule, a line break), so a child stored on it is
 * never drawn. A view takes its children only through `drawnParts`, so a view
 * added there that draws children and is not named here draws none, which its
 * own tests see at once, rather than drawing children the walk for a
 * passage's headings never reads.
 */
// Exported for its test only: the package entries export `RichText` alone.
export const VIEWS_DRAWING_CHILDREN: Readonly<Record<string, ChildrenDrawn>> = {
  heading: "heading",
  "collapsible-title": "summary",
  "collapsible-container": "inside",
  link: "inside",
  autolink: "inside",
  list: "inside",
  code: "inside",
  table: "inside",
  tablecell: "inside",
};

const DRAWS_NOTHING: DrawnParts = { inside: [], after: [] };

/** A phrasing-only container's children: what it keeps, and what follows it. */
function phrasingParts(
  node: RichTextNode,
  permits: ReadonlySet<string>
): DrawnParts {
  const kids = kidsOf(node);
  if (!holdsBlockContent(kids)) return { inside: kids, after: [] };
  const { keeps, moves } = partitionPhrasing(kids, permits);
  return { inside: keeps, after: moves };
}

/**
 * What the renderer draws of one node's children, decided as
 * {@link RichTextNodeView} dispatches it: a simple element and the
 * unknown-node fallback draw all of them, a view draws what
 * {@link VIEWS_DRAWING_CHILDREN} says, and a text leaf draws none.
 */
function drawnParts(node: RichTextNode): DrawnParts {
  if (Object.hasOwn(SIMPLE_ELEMENTS, node.type))
    return { inside: kidsOf(node), after: [] };
  if (Object.hasOwn(NODE_VIEWS, node.type)) {
    const drawn = Object.hasOwn(VIEWS_DRAWING_CHILDREN, node.type)
      ? VIEWS_DRAWING_CHILDREN[node.type]
      : undefined;
    if (drawn === "heading") return phrasingParts(node, PERMITS_NOTHING);
    if (drawn === "summary") return phrasingParts(node, SUMMARY_PERMITS);
    if (drawn === "inside") return { inside: kidsOf(node), after: [] };
    return DRAWS_NOTHING;
  }
  if (typeof node.text === "string") return DRAWS_NOTHING;
  return { inside: kidsOf(node), after: [] };
}

/**
 * A reader of `drawnParts` that answers each node once.
 *
 * Once, and not merely for speed: a heading's partition rebuilds the nodes it
 * keeps (a heading inside a disclosure label is copied with the children it
 * may hold), so two partitions of one node give two different copies. The
 * render and the walk for its headings share one reader, so the heading the
 * walk gave an id is the very node the render draws.
 */
function partsReader(): PartsReader {
  const read = new WeakMap<RichTextNode, DrawnParts>();
  return node => {
    const known = read.get(node);
    if (known !== undefined) return known;
    const parts = drawnParts(node);
    read.set(node, parts);
    return parts;
  };
}

/**
 * How many nodes one reading of a passage's headings visits at most, the
 * words of each heading included. A stored passage has no size of its own;
 * past this the reading keeps the headings it found, and the headings after
 * them are drawn without ids, as the table of contents leaves them out.
 */
const MAX_HEADING_VISITS = 50_000;

/** What one reading of a passage's headings may still visit. */
interface VisitBudget {
  left: number;
}

/** Puts nodes on a walk's stack so they pop in their order. */
function pushInOrder(stack: unknown[], nodes: readonly RichTextNode[]): void {
  for (let i = nodes.length - 1; i >= 0; i -= 1) stack.push(nodes[i]);
}

/** The words a leaf draws: its text, a line break's space, or none. */
function leafWords(node: RichTextNode): string {
  if (node.type === "linebreak") return " ";
  if (typeof node.text !== "string") return "";
  // A code token draws its text; any other view keeps a `text` field of its
  // own (a button's label) that is not a heading's words.
  return node.type === "code-highlight" || !Object.hasOwn(NODE_VIEWS, node.type)
    ? node.text
    : "";
}

/**
 * Visits nodes in the order they are drawn, within the budget. `visit` names
 * what comes after a node, in order: the lists it returns are walked first to
 * last before the nodes that followed it.
 */
function walkDrawn(
  nodes: readonly RichTextNode[],
  budget: VisitBudget,
  visit: (node: RichTextNode) => readonly (readonly RichTextNode[])[]
): void {
  const stack: unknown[] = [];
  pushInOrder(stack, nodes);
  while (stack.length > 0 && budget.left > 0) {
    const node = stack.pop();
    budget.left -= 1;
    if (!isRichTextNode(node)) continue;
    const next = visit(node);
    for (let i = next.length - 1; i >= 0; i -= 1) pushInOrder(stack, next[i]);
  }
}

/** The words a heading draws, read through the same parts the render draws. */
function drawnWords(
  nodes: readonly RichTextNode[],
  parts: PartsReader,
  budget: VisitBudget
): string {
  const words: string[] = [];
  walkDrawn(nodes, budget, node => {
    words.push(leafWords(node));
    return [parts(node).inside];
  });
  return words.join("").replace(/\s+/g, " ").trim();
}

/** Every heading a passage's nodes draw, in the order they are drawn. */
function headingsOf(
  nodes: readonly RichTextNode[],
  parts: PartsReader
): HeadingAnchor[] {
  const anchors: HeadingAnchor[] = [];
  const ids = anchorAllocator();
  const budget: VisitBudget = { left: MAX_HEADING_VISITS };
  walkDrawn(nodes, budget, node => {
    const { inside, after } = parts(node);
    const text =
      node.type === "heading" ? drawnWords(inside, parts, budget) : "";
    // A heading with no words has no anchor: a link to it would have none.
    if (text !== "")
      anchors.push({ node, id: ids.take(text), text, rank: headingRank(node) });
    // Walked as the render draws them: the node's own children, then what it
    // moved out after itself.
    return [inside, after];
  });
  return anchors;
}

/**
 * Every heading a stored passage draws, in order, each with its id and the
 * words it draws, read by the walk `RichText` draws the passage with.
 *
 * Takes `unknown` because it reads a block prop, which holds whatever was
 * stored: anything that is not rich text draws no headings.
 */
export function passageHeadings(value: unknown): readonly HeadingAnchor[] {
  if (!isRichTextValue(value)) return [];
  return headingsOf(value.root.children, partsReader());
}

/**
 * A container that may hold only phrasing content, with the rest moved AFTER it.
 *
 * `h1`-`h6` take phrasing content, and `summary` takes phrasing content or a
 * single heading — so a decorator inserted with the caret in a heading or in a
 * disclosure label puts a `<figure>` or a button row somewhere neither may go.
 *
 * Unlike a paragraph, the element cannot simply be swapped for a `div`. The tag
 * IS the meaning here: an `h2` is what puts the text in the document outline and
 * what a search engine reads, and `summary` is what makes a `details` operable
 * at all — it has to be the first child, so replacing it removes the disclosure.
 *
 * So the container keeps its tag and its phrasing children, and anything block
 * follows it as a SIBLING. That lands correctly in both cases: after a heading
 * the media sits in the flow where the author put it, and after a `summary` it
 * becomes part of the disclosure's body, which is the only place inside a
 * `details` it can legally go.
 *
 * An INLINE wrapper holding both — a link around a label AND an image — is
 * SPLIT rather than moved whole, and the wrapper is kept on both sides. Moving
 * it whole drags the label out and leaves the container empty, which is the
 * opposite of the property this exists to protect: a heading whose words happen
 * to sit inside a link is still a heading with words. Duplicating an inline
 * wrapper costs nothing in the outline and keeps the author's link on the words
 * and on the media alike.
 *
 * A BLOCK container is never duplicated that way. Where `summary` permits a
 * heading — it does, phrasing content optionally intermixed with heading
 * content — that heading is kept and its own block content leaves UNWRAPPED,
 * because re-wrapping it in a copy of the heading would put a second entry in
 * the document outline.
 */
function PhrasingOnly({
  tag: Tag,
  node,
  draw,
  id,
}: {
  tag: "h1" | "summary";
  node: RichTextNode;
  draw: DrawSettings;
  /** The element's anchor, for a heading drawn with one. */
  id?: string;
}): ReactNode {
  const anchor = id === undefined ? {} : { id };
  // Its kept children, and its block content after it: `phrasingParts`.
  const { inside, after } = draw.parts(node);
  if (after.length === 0)
    return <Tag {...anchor}>{children(inside, draw)}</Tag>;
  return (
    <>
      <Tag {...anchor}>{children(inside, draw)}</Tag>
      {children(after, draw)}
    </>
  );
}

function HeadingView({
  node,
  draw,
}: {
  node: RichTextNode;
  draw: DrawSettings;
}): ReactNode {
  // `h2` rather than `h1` when the tag is unrecognised: guessing `h1` invents a
  // second top-level heading and breaks the page outline, which is worse than
  // rendering one level too deep.
  // The level is read by the same rule a table of contents lists it by.
  const Heading = `h${headingRank(node)}` as "h1";
  const id = draw.anchors?.get(node);
  return (
    <PhrasingOnly
      tag={Heading}
      node={node}
      draw={draw}
      {...(id === undefined ? {} : { id })}
    />
  );
}

function LinkView({
  node,
  draw,
}: {
  node: RichTextNode;
  draw: DrawSettings;
}): ReactNode {
  // Sanitized, not merely read: the destination is stored text that lands in an
  // `href`. `url()` is the same boundary the URL props cross, so a scheme
  // refused in a button cannot be reached through a link beside it.
  const href = url(node.url);
  // A link with no usable destination renders as text. An anchor to nowhere is
  // announced as a link by a screen reader and goes nowhere when followed, and
  // that is also the right answer for a destination this refuses: the author's
  // words survive, the navigation does not.
  // A link around something ALREADY interactive renders as its children alone.
  // The buttons inside it navigate on their own, so nothing is lost but the
  // wrapper the parser was going to take apart anyway — and taking it apart is
  // not a tidy failure: it leaves a second, empty anchor in the middle of the
  // row, which is focusable and announced with no name.
  if (href === undefined || holdsInteractive(node.children))
    return <>{children(draw.parts(node).inside, draw)}</>;

  // Only `_blank` is honoured. It is the one target the editor writes, and it
  // is the one that needs the `rel` below; passing an arbitrary stored string
  // through would let a document name a frame elsewhere on the page.
  const target = node.target === "_blank" ? "_blank" : undefined;
  return (
    <a href={href} target={target} rel={relFor(target, node.rel)}>
      {children(draw.parts(node).inside, draw)}
    </a>
  );
}

function TableCellView({
  node,
  draw,
}: {
  node: RichTextNode;
  draw: DrawSettings;
}): ReactNode {
  // Lexical marks a header cell with `headerState`, a bitfield where any set bit
  // means the cell heads its row or its column.
  const header = typeof node.headerState === "number" && node.headerState !== 0;
  const Cell = header ? "th" : "td";
  return <Cell>{children(draw.parts(node).inside, draw)}</Cell>;
}

/**
 * The nodes that are more than an element around their children.
 *
 * Keyed rather than branched for the same reason as {@link SIMPLE_ELEMENTS}: a
 * lookup makes "which types does this renderer know" answerable by reading one
 * list, where a chain of `if`s hides it in control flow.
 */
const NODE_VIEWS: Readonly<
  Record<string, (node: RichTextNode, draw: DrawSettings) => ReactNode>
> = {
  heading: (node, draw) => <HeadingView node={node} draw={draw} />,
  // `open` is serialized by the editor, default included, so a section the
  // author left expanded publishes expanded.
  "collapsible-container": (node, draw) => (
    <details open={node.open === true}>
      {children(draw.parts(node).inside, draw)}
    </details>
  ),
  // A `summary` is phrasing-only and cannot be swapped for a `div` — it has to
  // be the first child of its `details` or the disclosure stops working — so it
  // takes the same treatment as a heading rather than the paragraph's.
  "collapsible-title": (node, draw) => (
    <PhrasingOnly tag="summary" node={node} draw={draw} />
  ),
  link: (node, draw) => <LinkView node={node} draw={draw} />,
  autolink: (node, draw) => <LinkView node={node} draw={draw} />,
  list: (node, draw) => {
    if (node.listType !== "number")
      return <ul>{children(draw.parts(node).inside, draw)}</ul>;
    // A list imported from `<ol start="5">` keeps its first number. Dropped,
    // the published list silently restarts at 1 and the prose around it —
    // "step 5" — stops matching. Only a positive integer is forwarded;
    // anything else is a value the attribute could not carry.
    const start =
      typeof node.start === "number" &&
      Number.isInteger(node.start) &&
      node.start > 0
        ? node.start
        : undefined;
    return <ol start={start}>{children(draw.parts(node).inside, draw)}</ol>;
  },
  linebreak: () => <br />,
  horizontalrule: () => <hr />,
  code: (node, draw) => (
    <pre>
      <code>{children(draw.parts(node).inside, draw)}</code>
    </pre>
  ),
  // `tbody` rather than bare rows: a browser inserts one anyway, and a React
  // tree that omits it does not match the DOM that results.
  table: (node, draw) => (
    <table>
      <tbody>{children(draw.parts(node).inside, draw)}</tbody>
    </table>
  ),
  tablecell: (node, draw) => <TableCellView node={node} draw={draw} />,
  "code-highlight": node => <CodeTokenView node={node} />,
  // The MEDIA leaves. Each keeps its content in its OWN fields rather than in
  // `children`, which is why the unknown-node fallback below cannot draw them:
  // it descends into children, finds none, and renders nothing at all. An
  // author who placed an image in their prose saw it in the editor and lost it
  // on the page, with nothing anywhere reporting the loss.
  image: (node, draw) => <ImageView node={node} draw={draw} />,
  gallery: (node, draw) => <GalleryView node={node} draw={draw} />,
  "button-link": node => <ButtonLinkView node={node} />,
  "button-group": node => <ButtonGroupView node={node} />,
};

/**
 * One syntax-highlighted token inside a code block.
 *
 * The class comes from the engine so this and the CMS's HTML agree about which
 * class a token type gets; a token whose type the engine rejects renders as
 * bare text rather than in an element that would carry no styling anyway.
 */
function CodeTokenView({ node }: { node: RichTextNode }): ReactNode {
  const text = typeof node.text === "string" ? node.text : "";
  const className = codeTokenClass(node.highlightType);
  if (className === undefined) return <>{text}</>;
  return <span className={className}>{text}</span>;
}

function RichTextNodeView({
  node,
  draw,
}: {
  node: RichTextNode;
  draw: DrawSettings;
}): ReactNode {
  // A stored document can hold anything JSON can express, including a null in a
  // `children` array. Reading `.text` off that throws, and it would throw during
  // render of a published page. The type says this cannot happen; the storage
  // does not.
  if (!isRichTextNode(node)) return null;

  // TYPE FIRST, then the generic text branch.
  //
  // `text` is not a text node's private field: a code token carries one, and so
  // does a button, whose label it holds. Asked the other way round, any node
  // with a `text` field returns as bare prose having lost the type that decides
  // what it IS — a button published as the stray words "Buy now" in the middle
  // of an article, and nothing anywhere reporting it.
  //
  // Ordering rather than a guard per type. The same collision was met once
  // before and answered with a `node.type === "code-highlight"` line in front of
  // the branch, which fixes the node that was noticed and leaves the next one
  // to be found the same way. A type this file knows is dispatched on its type;
  // only a node no table claims falls through to be read as text.
  //
  // `Object.hasOwn` before either lookup, because `node.type` is a stored string
  // and these tables inherit from `Object.prototype`. A node typed
  // `"constructor"` or `"toString"` would otherwise resolve to an inherited
  // function — used as a JSX element type, or called as a view — and throw,
  // instead of taking the unknown-node fallback that exists for exactly this.
  if (Object.hasOwn(SIMPLE_ELEMENTS, node.type)) {
    const declared = SIMPLE_ELEMENTS[node.type] as "p";
    // Only `p` is narrowed HERE. `li`, `blockquote` and `div` take flow content,
    // so a figure or a grid inside one of them is valid as it stands. The other
    // phrasing-only containers — headings and `summary` — cannot be swapped for
    // a `div` without losing what their tag means, so they are handled by
    // {@link PhrasingOnly} instead of by this table.
    const Element =
      declared === "p" && holdsBlockContent(node.children) ? "div" : declared;
    return <Element>{children(draw.parts(node).inside, draw)}</Element>;
  }

  if (Object.hasOwn(NODE_VIEWS, node.type)) {
    const view = NODE_VIEWS[node.type];
    if (view !== undefined) return view(node, draw);
  }

  if (typeof node.text === "string")
    return formatted(node.text, node.format, node.style);

  // Unknown node: keep the words, lose the wrapper. See the module docblock.
  return <>{children(draw.parts(node).inside, draw)}</>;
}

export interface RichTextProps {
  /** The stored value. Anything that is not rich text renders nothing. */
  value: unknown;
  /**
   * Site-operator decisions the media inside this value enforces.
   *
   * Passed as a PROP rather than read from a React context, because this entry
   * renders on the server: a context would make every page drawing rich text a
   * client component, which is a cost out of all proportion to reading one
   * optional object. It is the same way a block receives it.
   *
   * ABSENT MEANS UNASKED, not allowed-nothing — the semantics
   * {@link BlockHostPolicy} states for `remotePatterns` itself. A caller that
   * passes nothing gets what it had before media rendered at all, rather than a
   * page whose images silently disappear the day it upgrades. The scheme filter
   * every stored URL crosses is NOT part of this bargain: it applies whether or
   * not a policy was supplied, because a `javascript:` href is not a site
   * operator's decision to make.
   */
  hostPolicy?: BlockHostPolicy;
  /**
   * Whether each heading is drawn with an id, so a link (a table of contents
   * among them) can reach it. Absent is none: a passage drawn somewhere other
   * than a page, such as an email, keeps its markup as it was.
   */
  anchorHeadings?: boolean;
}

/**
 * Render a stored rich-text value.
 *
 * Takes `unknown` rather than `RichTextValue` because it is called with a block
 * prop, and a prop's stored type is whatever was saved — a string from before a
 * field became rich, a null, an empty object. Narrowing here means one check in
 * one place instead of one at every call site, and it means a prop holding the
 * wrong thing renders nothing rather than throwing on a live page.
 */
export function RichText({
  value,
  hostPolicy,
  anchorHeadings,
}: RichTextProps): ReactNode {
  if (!isRichTextValue(value)) return null;
  // One reader for the render and for its headings' ids, so each id is found
  // on the node the render draws (see `partsReader`).
  const parts = partsReader();
  const draw: DrawSettings = {
    host: hostPolicy,
    parts,
    ...(anchorHeadings === true
      ? { anchors: anchorIds(headingsOf(value.root.children, parts)) }
      : {}),
  };
  return <>{children(value.root.children, draw)}</>;
}
