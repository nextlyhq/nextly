import {
  hasFormat,
  isRichTextValue,
  TEXT_FORMAT,
  type RichTextNode,
} from "@nextlyhq/blocks-engine";
import type { ReactNode } from "react";

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
 * ## Unknown nodes render their children
 *
 * A site can register node types this renderer has never heard of. Dropping an
 * unknown node would silently delete an author's content; refusing to render
 * would take the page down for one unrecognised paragraph. Descending into its
 * children keeps the words and loses only the wrapper, which is the forgiving
 * behaviour the format asks for everywhere else.
 *
 * @module rich-text
 */

/** Wraps text in the elements its format bits ask for, innermost first. */
function formatted(text: string, format: number | undefined): ReactNode {
  let out: ReactNode = text;
  // Order matters only in that it decides nesting, not meaning. Code last so it
  // wraps the rest, matching how the CMS's serializer reads.
  if (hasFormat(format, TEXT_FORMAT.SUBSCRIPT)) out = <sub>{out}</sub>;
  if (hasFormat(format, TEXT_FORMAT.SUPERSCRIPT)) out = <sup>{out}</sup>;
  if (hasFormat(format, TEXT_FORMAT.STRIKETHROUGH)) out = <s>{out}</s>;
  if (hasFormat(format, TEXT_FORMAT.UNDERLINE)) out = <u>{out}</u>;
  if (hasFormat(format, TEXT_FORMAT.ITALIC)) out = <em>{out}</em>;
  if (hasFormat(format, TEXT_FORMAT.BOLD)) out = <strong>{out}</strong>;
  if (hasFormat(format, TEXT_FORMAT.HIGHLIGHT)) out = <mark>{out}</mark>;
  if (hasFormat(format, TEXT_FORMAT.CODE)) out = <code>{out}</code>;
  return out;
}

function children(nodes: readonly RichTextNode[] | undefined): ReactNode {
  if (nodes === undefined) return null;
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
const SIMPLE_ELEMENTS: Readonly<Record<string, "p" | "blockquote" | "li">> = {
  paragraph: "p",
  quote: "blockquote",
  listitem: "li",
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
  const url = typeof node.url === "string" ? node.url : null;
  // A link with no destination renders as text. An anchor to nowhere is
  // announced as a link by a screen reader and goes nowhere when followed.
  if (url === null) return <>{children(node.children)}</>;
  return <a href={url}>{children(node.children)}</a>;
}

function RichTextNodeView({ node }: { node: RichTextNode }): ReactNode {
  if (typeof node.text === "string") return formatted(node.text, node.format);

  const simple = SIMPLE_ELEMENTS[node.type];
  if (simple !== undefined) {
    const Element = simple;
    return <Element>{children(node.children)}</Element>;
  }

  if (node.type === "heading") return <HeadingView node={node} />;
  if (node.type === "link" || node.type === "autolink") {
    return <LinkView node={node} />;
  }
  if (node.type === "list") {
    const List = node.listType === "number" ? "ol" : "ul";
    return <List>{children(node.children)}</List>;
  }
  if (node.type === "linebreak") return <br />;

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
