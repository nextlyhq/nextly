/**
 * `core/heading` — a section title.
 *
 * The level is STORED, never derived from the node's depth in the tree. A
 * builder that computes it from nesting produces a document whose outline
 * changes when a block is dragged, which is precisely the accessibility failure
 * headings exist to prevent: the level describes the content's structure, not
 * the editor's.
 *
 * Every heading with words carries an id, its anchor in the page outline
 * (`../outline`): unique on the whole page, so a link to a section lands on
 * the right one. A heading an author leaves out of the table of contents
 * (`tocExclude`) keeps its anchor; only the contents list skips it.
 *
 * @module blocks/heading
 */
import { type BlockDefinition, defineBlock } from "@nextlyhq/blocks-engine";
import { createElement } from "react";
import type { ReactElement } from "react";

import type { BlockRenderArgs, PageContext } from "../context";
import { headingAnchors } from "../outline";

import { CONTENT } from "./categories";
import { rankOfTag } from "./heading-anchors";
import {
  addressLinkFor,
  boundText,
  canLink,
  LINK_PROPS,
  linkFor,
  linksToEntry,
  readClaimOf,
  text,
  type LinkAttributes,
  type LinkProps,
} from "./props";
import { HEADING_CONVERTERS } from "./text-conversions";

/** The levels a heading may render. */
export const HEADING_LEVELS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

export type HeadingLevel = (typeof HEADING_LEVELS)[number];

/**
 * A heading's props. Its optional link is the shared one every linking block
 * declares (an address or an entry, and how it opens), wrapped INSIDE the
 * heading, not around it.
 */
export interface HeadingProps extends LinkProps {
  /** The heading text. */
  text?: string;
  /** Which heading level to render. */
  level?: HeadingLevel;
  /**
   * Left out of a table of contents. The heading keeps its anchor, so a link
   * written by hand still reaches it.
   */
  tocExclude?: boolean;
}

/**
 * Render a heading, linked where its props say. Only a link to an entry
 * waits, for the entry's path; a heading linking by address, or not at all,
 * renders at once, as it always did.
 */
export function renderHeading(
  args: BlockRenderArgs<HeadingProps>
): ReactElement | Promise<ReactElement> {
  const { props, ctx, node } = args;
  if (linksToEntry(props)) {
    // Claimed as this block's, as every linking block's entry read is.
    return linkFor(props, (collection, id) =>
      ctx.resolveEntryPath(collection, id, readClaimOf(node))
    ).then(link => drawHeading(args, link));
  }
  return drawHeading(args, addressLinkFor(props));
}

/** The heading element, with its words inside the link where it has one. */
function drawHeading(
  {
    props,
    className,
    markProp,
    bound,
    ctx,
    node,
  }: BlockRenderArgs<HeadingProps>,
  link: LinkAttributes | undefined
): ReactElement {
  // Drawn at the level the page outline lists it at: `h1` to `h6`, else `h2`.
  const level: HeadingLevel = `h${rankOfTag(props.level)}`;
  // Its anchor in the page outline. An author's own CSS id is that anchor,
  // and the boundary draws it on the same element.
  const [anchor] = headingAnchors(ctx, node);
  // A bound date keeps its machine-readable value, inside the anchor or the
  // heading itself.
  const label = boundText(text(props.text), bound?.text);

  // The text moves between two elements, which is why the block marks it rather
  // than an editor inferring it: linked, the words live inside the anchor;
  // unlinked, they are the heading's own child.
  const mark = markProp?.("text") ?? {};

  // The anchor goes INSIDE the heading. Wrapping the heading in a link instead
  // would put a block-level element in a phrasing context and, more usefully,
  // would make a screen reader announce the whole heading as a link even when
  // only part of it is meant to be one.
  const content =
    link === undefined
      ? label
      : createElement("a", { ...link, ...mark }, label);

  return createElement(
    level,
    {
      className,
      ...(anchor === undefined ? {} : { id: anchor }),
      ...(link === undefined ? mark : {}),
    },
    content
  );
}

// Defined against the ENGINE's `defineBlock`, not the plugin SDK's: the engine
// declares the contract and the SDK re-exports it for third parties. The
// context is named rather than augmented, so a block compiled against the
// published types is typed the same as one compiled here. See `./index.ts`.
export const heading: BlockDefinition<HeadingProps, PageContext> = defineBlock({
  name: "core/heading",
  version: 1,
  // What an author reads, in the Add panel and the block card: one plain line.
  // What the block does, for whoever maintains it: A section title. The level
  // is chosen by the author, so the page outline stays stable when blocks move.
  description: "A title for a page or section.",
  // Palette metadata. The category is imported rather than spelled here so
  // nineteen blocks cannot drift into nineteen headings; keywords are what
  // let a search for a word the description never uses still find this.
  editor: {
    label: "Heading",
    icon: "heading",
    category: CONTENT,
    keywords: ["title", "headline", "h1", "h2"],
  },
  props: {
    text: { label: "Text", role: "content", type: "text", inline: true },
    level: {
      label: "Level",
      hint: "Use Heading 1 once per page.",
      optionLabels: {
        h1: "Heading 1",
        h2: "Heading 2",
        h3: "Heading 3",
        h4: "Heading 4",
        h5: "Heading 5",
        h6: "Heading 6",
      },
      type: "select",
      options: [...HEADING_LEVELS],
    },
    // The shared link, in its own Content › Link section as a Box's is: a
    // page, an entry or an address, and "Open in a new tab". The stored names
    // are the ones the heading always used; the relationship is in Advanced.
    href: { ...LINK_PROPS.href, section: "Link" },
    entryCollection: { ...LINK_PROPS.entryCollection, section: "Link" },
    entryId: { ...LINK_PROPS.entryId, section: "Link" },
    target: { ...LINK_PROPS.target, section: "Link" },
    rel: LINK_PROPS.rel,
    // Off by default: every heading is listed until its author says not.
    tocExclude: {
      label: "Leave out of table of contents",
      type: "checkbox",
      group: "advanced",
      section: "Visibility",
    },
  },
  defaultProps: { text: "", level: "h2" },
  // No `seo` offer: a heading never sets the page's title. The browser tab and
  // a search result read the page's SEO title, else its title in the content
  // type's pattern; a heading's wording is written for the reader of the
  // page, and the first one on it is often a slogan, not a name.
  example: { props: { text: "A section title", level: "h2" } },
  supports: {
    typography: true,
    color: true,
    background: true,
    spacing: true,
    dimensions: true,
    border: true,
    effects: true,
    position: true,
  },
  // A heading with a destination renders an `<a>` inside it, so it is
  // interactive while linked, to an address or an entry.
  contentModel: props =>
    canLink(props) ? { is: ["flow", "interactive"] } : { is: ["flow"] },
  // "Turn into" Text or Rich text: the words, and a link to an address.
  converters: HEADING_CONVERTERS,
  render: renderHeading,
});
