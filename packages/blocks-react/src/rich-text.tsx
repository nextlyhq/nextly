import {
  codeTokenClass,
  hasFormat,
  isRichTextNode,
  isRichTextValue,
  TEXT_FORMAT,
  type RichTextNode,
} from "@nextlyhq/blocks-engine";
import type { CSSProperties, ReactNode } from "react";

import { relFor, url } from "./blocks/props";

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

/**
 * The element each format bit wraps text in, outermost LAST.
 *
 * A table rather than a run of `if`s: every entry says the same thing, and the
 * order is data — `code` sits at the end so it wraps the rest, matching how the
 * CMS's serializer nests them. Read as a list, a reordering is visible; read as
 * eight branches, it is not.
 */
const FORMAT_ELEMENTS: readonly {
  flag: (typeof TEXT_FORMAT)[keyof typeof TEXT_FORMAT];
  wrap: (inner: ReactNode) => ReactNode;
}[] = [
  { flag: TEXT_FORMAT.SUBSCRIPT, wrap: inner => <sub>{inner}</sub> },
  { flag: TEXT_FORMAT.SUPERSCRIPT, wrap: inner => <sup>{inner}</sup> },
  { flag: TEXT_FORMAT.STRIKETHROUGH, wrap: inner => <s>{inner}</s> },
  { flag: TEXT_FORMAT.UNDERLINE, wrap: inner => <u>{inner}</u> },
  { flag: TEXT_FORMAT.ITALIC, wrap: inner => <em>{inner}</em> },
  { flag: TEXT_FORMAT.BOLD, wrap: inner => <strong>{inner}</strong> },
  { flag: TEXT_FORMAT.HIGHLIGHT, wrap: inner => <mark>{inner}</mark> },
  { flag: TEXT_FORMAT.CODE, wrap: inner => <code>{inner}</code> },
];

/**
 * How the three case formats are drawn.
 *
 * A transform rather than an element, because that is what they are: the stored
 * text is unchanged and only its presentation differs, so wrapping it in a tag
 * would assert a meaning the author did not choose. The values are constants
 * from this table and never stored text, so no author input reaches a style.
 */
const CASE_TRANSFORM: readonly {
  flag: (typeof TEXT_FORMAT)[keyof typeof TEXT_FORMAT];
  value: "lowercase" | "uppercase" | "capitalize";
}[] = [
  { flag: TEXT_FORMAT.LOWERCASE, value: "lowercase" },
  { flag: TEXT_FORMAT.UPPERCASE, value: "uppercase" },
  { flag: TEXT_FORMAT.CAPITALIZE, value: "capitalize" },
];

/** Wraps text in the elements its format bits ask for, innermost first. */
function formatted(text: string, format: number | undefined): ReactNode {
  let out: ReactNode = text;
  for (const { flag, wrap } of FORMAT_ELEMENTS) {
    if (hasFormat(format, flag)) out = wrap(out);
  }

  // Outermost, and only one can apply: `text-transform` is a single CSS
  // property, so a value carrying two case bits would otherwise render whichever
  // wrapper happened to be inner. Taking the first keeps that deterministic.
  const transform = CASE_TRANSFORM.find(entry => hasFormat(format, entry.flag));
  if (transform === undefined) return out;
  const style: CSSProperties = { textTransform: transform.value };
  return <span style={style}>{out}</span>;
}

function children(nodes: readonly RichTextNode[] | undefined): ReactNode {
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
    <RichTextNodeView key={i} node={node} />
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
  "collapsible-title": "summary",
  "collapsible-content": "div",
  tablerow: "tr",
};

/** Heading levels Lexical serializes; anything else is a document from a version this does not know. */
const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

function HeadingView({ node }: { node: RichTextNode }): ReactNode {
  // `h2` rather than `h1` when the tag is unrecognised: guessing `h1` invents a
  // second top-level heading and breaks the page outline, which is worse than
  // rendering one level too deep.
  const tag =
    typeof node.tag === "string" && HEADING_TAGS.has(node.tag)
      ? node.tag
      : "h2";
  const Heading = tag as "h1";
  return <Heading>{children(node.children)}</Heading>;
}

function LinkView({ node }: { node: RichTextNode }): ReactNode {
  // Sanitized, not merely read: the destination is stored text that lands in an
  // `href`. `url()` is the same boundary the URL props cross, so a scheme
  // refused in a button cannot be reached through a link beside it.
  const href = url(node.url);
  // A link with no usable destination renders as text. An anchor to nowhere is
  // announced as a link by a screen reader and goes nowhere when followed, and
  // that is also the right answer for a destination this refuses: the author's
  // words survive, the navigation does not.
  if (href === undefined) return <>{children(node.children)}</>;

  // Only `_blank` is honoured. It is the one target the editor writes, and it
  // is the one that needs the `rel` below; passing an arbitrary stored string
  // through would let a document name a frame elsewhere on the page.
  const target = node.target === "_blank" ? "_blank" : undefined;
  return (
    <a href={href} target={target} rel={relFor(target, node.rel)}>
      {children(node.children)}
    </a>
  );
}

function TableCellView({ node }: { node: RichTextNode }): ReactNode {
  // Lexical marks a header cell with `headerState`, a bitfield where any set bit
  // means the cell heads its row or its column.
  const header = typeof node.headerState === "number" && node.headerState !== 0;
  const Cell = header ? "th" : "td";
  return <Cell>{children(node.children)}</Cell>;
}

/**
 * The nodes that are more than an element around their children.
 *
 * Keyed rather than branched for the same reason as {@link SIMPLE_ELEMENTS}: a
 * lookup makes "which types does this renderer know" answerable by reading one
 * list, where a chain of `if`s hides it in control flow.
 */
const NODE_VIEWS: Readonly<Record<string, (node: RichTextNode) => ReactNode>> =
  {
    heading: node => <HeadingView node={node} />,
    // `open` is serialized by the editor, default included, so a section the
    // author left expanded publishes expanded.
    "collapsible-container": node => (
      <details open={node.open === true}>{children(node.children)}</details>
    ),
    link: node => <LinkView node={node} />,
    autolink: node => <LinkView node={node} />,
    list: node => {
      if (node.listType !== "number") return <ul>{children(node.children)}</ul>;
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
      return <ol start={start}>{children(node.children)}</ol>;
    },
    linebreak: () => <br />,
    horizontalrule: () => <hr />,
    code: node => (
      <pre>
        <code>{children(node.children)}</code>
      </pre>
    ),
    // `tbody` rather than bare rows: a browser inserts one anyway, and a React
    // tree that omits it does not match the DOM that results.
    table: node => (
      <table>
        <tbody>{children(node.children)}</tbody>
      </table>
    ),
    tablecell: node => <TableCellView node={node} />,
    "code-highlight": node => <CodeTokenView node={node} />,
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

function RichTextNodeView({ node }: { node: RichTextNode }): ReactNode {
  // A stored document can hold anything JSON can express, including a null in a
  // `children` array. Reading `.text` off that throws, and it would throw during
  // render of a published page. The type says this cannot happen; the storage
  // does not.
  if (!isRichTextNode(node)) return null;

  // Before the generic text branch: a code token carries `text` too, and would
  // otherwise return here having lost the type that decides its class.
  if (node.type === "code-highlight") return <CodeTokenView node={node} />;

  if (typeof node.text === "string") return formatted(node.text, node.format);

  // `Object.hasOwn` before either lookup, because `node.type` is a stored string
  // and these tables inherit from `Object.prototype`. A node typed
  // `"constructor"` or `"toString"` would otherwise resolve to an inherited
  // function — used as a JSX element type, or called as a view — and throw,
  // instead of taking the unknown-node fallback that exists for exactly this.
  if (Object.hasOwn(SIMPLE_ELEMENTS, node.type)) {
    const Element = SIMPLE_ELEMENTS[node.type] as "p";
    return <Element>{children(node.children)}</Element>;
  }

  if (Object.hasOwn(NODE_VIEWS, node.type)) {
    const view = NODE_VIEWS[node.type];
    if (view !== undefined) return view(node);
  }

  // Unknown node: keep the words, lose the wrapper. See the module docblock.
  return <>{children(node.children)}</>;
}

export interface RichTextProps {
  /** The stored value. Anything that is not rich text renders nothing. */
  value: unknown;
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
export function RichText({ value }: RichTextProps): ReactNode {
  if (!isRichTextValue(value)) return null;
  return <>{children(value.root.children)}</>;
}
