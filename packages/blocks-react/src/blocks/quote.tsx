/**
 * `core/quote` — quoted text with an optional attribution.
 *
 * `<blockquote>` carries the quotation, and the attribution sits in a `<figure>`
 * beside it rather than inside it. Putting the speaker's name inside the
 * blockquote makes it part of the quotation, which says the person quoted also
 * said their own name.
 *
 * `<cite>` marks the TITLE of a work, not a person, so it wraps the source when
 * one is given and never the attribution alone.
 *
 * Where the quote comes from is the shared link every linking block stores
 * (an address or an entry, a new tab, a relationship): it becomes `cite` on
 * the blockquote, and the source's title links to it. The dash before the
 * person's name is drawn by CSS, so it is never part of the words a reader
 * copies or a screen reader reads as text.
 *
 * @module blocks/quote
 */
import { type BlockDefinition, defineBlock } from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";

import type { BlockRenderArgs, PageContext } from "../context";

import { CONTENT } from "./categories";
import { quoteLooks } from "./looks";
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

export interface QuoteProps extends LinkProps {
  /** The quoted text. */
  text?: string;
  /** Who said it. */
  attribution?: string;
  /** The work it came from, which links where the shared link goes. */
  source?: string;
}

/**
 * The mark of the empty element before the person's name the dash is drawn
 * on. Its own element, hidden from screen readers, so the dash is never
 * read out as part of the name either.
 */
const DASH_ATTRIBUTE = "data-nx-quote-dash";

/**
 * The dash before the person's name: generated content, which no reader
 * copies with the words. Hoisted and deduped by React, one copy per page,
 * and carried by every attributed quote so none reaches a page without it.
 */
const QUOTE_CSS = `[${DASH_ATTRIBUTE}]::before{content:"\\2014\\00a0"}`;

/** The key the quote's rule is hoisted under. */
const QUOTE_STYLE_KEY = "nx-quote";

/**
 * Render a quote, its source linked where its link says. Only a link to an
 * entry waits, for the entry's path; one by address, or none, renders at once.
 */
export function renderQuote(
  args: BlockRenderArgs<QuoteProps>
): ReactElement | Promise<ReactElement> {
  const { props, ctx, node } = args;
  if (linksToEntry(props)) {
    // Claimed as this block's, as every linking block's entry read is.
    return linkFor(props, (collection, id) =>
      ctx.resolveEntryPath(collection, id, readClaimOf(node))
    ).then(link => drawQuote(args, link));
  }
  return drawQuote(args, addressLinkFor(props));
}

/** The quote, with `cite` and its source's link where it has one. */
function drawQuote(
  { props, className, markProp, partClass, bound }: BlockRenderArgs<QuoteProps>,
  link: LinkAttributes | undefined
): ReactElement {
  const quoted = boundText(text(props.text), bound?.text);
  // Kept as text for the emptiness tests below; the date markup, when there is
  // one, is added where each is drawn.
  const attribution = text(props.attribution);
  const source = text(props.source);
  const cite = link === undefined ? {} : { cite: link.href };
  const markText = markProp?.("text");
  // The source's words are marked where they are drawn: inside its link
  // when it has one, else on the `<cite>` itself.
  const markSource = markProp?.("source");

  // With nothing to attribute, the blockquote IS the block and takes the class.
  if (attribution === "" && source === "") {
    return (
      <blockquote className={className} {...cite}>
        <p {...markText}>{quoted}</p>
      </blockquote>
    );
  }
  // Marked as a PART rather than given the block's own class: the figure
  // around it already takes that class, and giving the same one to the
  // quotation inside applies the whole default twice.
  return (
    <figure className={className}>
      <blockquote className={partClass("quotation")} {...cite}>
        <p {...markText}>{quoted}</p>
      </blockquote>
      <figcaption className={partClass("attribution")}>
        {attribution === "" ? null : (
          <>
            <style href={QUOTE_STYLE_KEY} precedence="default">
              {QUOTE_CSS}
            </style>
            <span {...{ [DASH_ATTRIBUTE]: "" }} aria-hidden="true" />
            {boundText(attribution, bound?.attribution)}
          </>
        )}
        {attribution !== "" && source !== "" ? ", " : null}
        {source === "" ? null : (
          <cite {...(link === undefined ? markSource : {})}>
            {link === undefined ? (
              boundText(source, bound?.source)
            ) : (
              <a {...link} {...markSource}>
                {boundText(source, bound?.source)}
              </a>
            )}
          </cite>
        )}
      </figcaption>
    </figure>
  );
}

/**
 * Version 1 to 2: the source's loose address becomes the shared link's
 * address. A new tab and a relationship are left unset, as version 1 had
 * neither; every other value is kept as it is.
 */
function fromVersion1(props: Record<string, unknown>): Record<string, unknown> {
  const { citeUrl, ...rest } = props;
  return typeof citeUrl === "string" && citeUrl.trim() !== ""
    ? { ...rest, href: citeUrl }
    : rest;
}

// Defined against the ENGINE's `defineBlock`, not the plugin SDK's: the engine
// declares the contract and the SDK re-exports it for third parties. The
// context is named rather than augmented, so a block compiled against the
// published types is typed the same as one compiled here. See `./index.ts`.
/**
 * What makes a quotation look quoted once a reset has flattened it.
 *
 * A browser marks a `<blockquote>` by indenting it — roughly `40px` on each
 * side — and that indent is the only thing separating it from a paragraph.
 * Tailwind's Preflight zeroes margin and padding on every element, and this
 * library's own scaffold imports it, so the element keeps its meaning for a
 * screen reader and loses it entirely for everyone else. Restoring the indent
 * is repair; it is not a look anyone chose.
 *
 * **Indented on the inline start only, not both sides.** A symmetric indent
 * reads as a narrower column rather than as a quotation, and it fights the
 * container width the site sheet already sets. One-sided is what a reader
 * recognises, and it follows writing direction rather than assuming
 * left-to-right.
 *
 * **No rule, no italics, no colour.** A vertical rule beside a quotation is the
 * commonest treatment and it is still a treatment: WordPress ships exactly that
 * border in its OPT-IN theme layer rather than its structural one, and italics
 * change how the words read rather than how the block is recognised. The line
 * this stops at is the one that separates a block that renders correctly from a
 * block that has been styled.
 *
 * `em` rather than `rem` for the same reason the typographic defaults use it:
 * the indent stays proportional to the quotation's own type size, so an author
 * who enlarges the quote does not leave its indent behind.
 */
/**
 * Named once: the renderer derives a class from it and the definition registers
 * under it, and two literals would be one contract with two spellings.
 */
const QUOTE_BLOCK = "core/quote";

const QUOTE_BASE_STYLES = {
  base: {
    base: {
      // The inline sides are zeroed, not left alone. A user agent indents a
      // `<blockquote>` and a `<figure>` by about 40px of its own, so in a host
      // with no reset that margin ADDS to the padding below and the indent is
      // whatever the browser happened to choose plus whatever this states.
      // The block sides are zeroed too: the quote is spaced from its
      // neighbours by the gap of whatever holds it, like every other block.
      margin: {
        blockStart: "0",
        blockEnd: "0",
        inlineStart: "0",
        inlineEnd: "0",
      },
      padding: { inlineStart: "1.5em" },
      // Line, the quote's own block style: a line on the inline start in the
      // site's accent colour, following writing direction. Plain and Large
      // are the looks that take it away.
      border: {
        width: {
          blockStart: "0",
          blockEnd: "0",
          inlineStart: "4px",
          inlineEnd: "0",
        },
        style: "solid",
        color: { $token: "color.primary" },
      },
    },
  },
} as const;

/**
 * The elements the attributed branch renders inside its `<figure>`.
 *
 * Only that branch has them: with nothing to attribute, the `<blockquote>` IS
 * the block and wears the block's own class, so the same element is a root in
 * one shape and a part in the other. The class it carries says which.
 */
const QUOTE_PARTS = {
  quotation: {
    baseStyles: {
      base: {
        base: {
          // The whole point of the part. A user agent gives `<blockquote>` a
          // margin of its own — about 40px inline and 1em block — and inside
          // the figure that ADDS to what the block already states, so in a host
          // with no reset the same quote sat at 24px bare and 64px attributed.
          // Typing an attribution moved the text.
          margin: {
            blockStart: "0",
            blockEnd: "0",
            inlineStart: "0",
            inlineEnd: "0",
          },
        },
      },
    },
  },
  attribution: {
    baseStyles: {
      base: {
        base: {
          // A caption for the quotation, not a second paragraph of it. Smaller
          // and set apart, so the reader can tell the speaker from the speech
          // without the two running together.
          fontSize: "0.875em",
          margin: { blockStart: "0.75em" },
        },
      },
    },
  },
} as const;

export const quote: BlockDefinition<QuoteProps, PageContext> = defineBlock({
  name: QUOTE_BLOCK,
  version: 2,
  migrate: { 1: fromVersion1 },
  // What an author reads, in the Add panel and the block card: one plain line.
  // What the block does, for whoever maintains it: Quoted text with an optional
  // attribution, kept outside the quotation so the speaker is not quoted saying
  // their own name.
  description: "A quotation, with who said it.",
  // Palette metadata. The category is imported rather than spelled here so
  // nineteen blocks cannot drift into nineteen headings; keywords are what
  // let a search for a word the description never uses still find this.
  editor: {
    label: "Quote",
    icon: "quote",
    category: CONTENT,
    keywords: ["blockquote", "pull quote", "citation"],
    // Its looks, Line (its own), Plain and Large, offered as tiles on a block
    // already on the page.
    variations: quoteLooks(),
  },
  baseStyles: QUOTE_BASE_STYLES,
  parts: QUOTE_PARTS,
  props: {
    text: {
      label: "Quote",
      role: "content",
      type: "textarea",
      inline: true,
    },
    attribution: { label: "Who said it", role: "content", type: "text" },
    source: {
      label: "Source",
      section: "Source",
      role: "content",
      type: "text",
      inline: true,
    },
    // Where the quote comes from: the shared link, in the Source section with
    // the source's title, which it links. Its relationship is in Advanced.
    href: { ...LINK_PROPS.href, label: "Source link", section: "Source" },
    entryCollection: { ...LINK_PROPS.entryCollection, section: "Source" },
    entryId: { ...LINK_PROPS.entryId, section: "Source" },
    target: { ...LINK_PROPS.target, section: "Source" },
    rel: LINK_PROPS.rel,
  },
  defaultProps: { text: "" },
  example: {
    props: {
      text: "Simplicity is the soul of efficiency.",
      attribution: "Austin Freeman",
    },
  },
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
  // Interactive content once its source's title draws a link, so a linked
  // Box or Card cannot hold it and nest one link in another. A link with no
  // title to draw it on is only the blockquote's `cite`, which is no link.
  contentModel: props =>
    canLink(props) && text(props.source) !== ""
      ? { is: ["flow", "interactive"] }
      : { is: ["flow"] },
  render: renderQuote,
});
