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
 * @module blocks/quote
 */
import { defineBlock } from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";

import type { BlockRenderArgs, PageContext } from "../context";

import { CONTENT } from "./categories";
import { text, url } from "./props";

export interface QuoteProps {
  /** The quoted text. */
  text?: string;
  /** Who said it. */
  attribution?: string;
  /** The work it came from. */
  source?: string;
  /** A URL for the source, which becomes `cite` on the blockquote. */
  citeUrl?: string;
}

export function renderQuote({
  props,
  className,
  markProp,
  partClass,
}: BlockRenderArgs<QuoteProps>): ReactElement {
  const quoted = text(props.text);
  const attribution = text(props.attribution);
  const source = text(props.source);
  const citeUrl = url(props.citeUrl);

  /*
   * Only the two values that already have an element of their own are marked.
   * `attribution` is a bare text node inside the figcaption, and an attribute
   * needs an element — wrapping it in a span to gain one would change the
   * published markup for the editor's convenience, which is the wrong trade.
   * It stays editable in the inspector, which is the safe direction.
   */
  const markText = markProp?.("text");
  const markSource = markProp?.("source");

  // Marked as a PART rather than given the block's own class. The attributed
  // branch wraps this in a `<figure>` that already takes that class, and giving
  // the same one to the quotation inside applies the whole default twice — the
  // indent as well as the reset — so an attributed quote would step in further
  // than a bare one. A part carries only what this element needs, which is the
  // user-agent margin removed.
  const blockquote = (
    <blockquote
      className={partClass("quotation")}
      {...(citeUrl === undefined ? {} : { cite: citeUrl })}
    >
      <p {...markText}>{quoted}</p>
    </blockquote>
  );

  // With nothing to attribute, the blockquote IS the block and takes the class.
  if (attribution === "" && source === "") {
    return (
      <blockquote
        className={className}
        {...(citeUrl === undefined ? {} : { cite: citeUrl })}
      >
        <p {...markText}>{quoted}</p>
      </blockquote>
    );
  }

  return (
    <figure className={className}>
      {blockquote}
      <figcaption className={partClass("attribution")}>
        {attribution}
        {attribution !== "" && source !== "" ? ", " : null}
        {source === "" ? null : <cite {...markSource}>{source}</cite>}
      </figcaption>
    </figure>
  );
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
      margin: {
        blockStart: "1.5em",
        blockEnd: "1.5em",
        inlineStart: "0",
        inlineEnd: "0",
      },
      padding: { inlineStart: "1.5em" },
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

export const quote = defineBlock<QuoteProps, PageContext>({
  name: QUOTE_BLOCK,
  version: 1,
  description:
    "Quoted text with an optional attribution, kept outside the quotation so the speaker is not quoted saying their own name.",
  // Palette metadata. The category is imported rather than spelled here so
  // nineteen blocks cannot drift into nineteen headings; keywords are what
  // let a search for a word the description never uses still find this.
  editor: {
    label: "Quote",
    icon: "quote",
    category: CONTENT,
    keywords: ["blockquote", "pull quote", "citation"],
  },
  baseStyles: QUOTE_BASE_STYLES,
  parts: QUOTE_PARTS,
  props: {
    text: { type: "textarea", inline: true },
    attribution: { type: "text" },
    source: { type: "text", inline: true },
    citeUrl: { type: "url" },
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
  render: renderQuote,
});
