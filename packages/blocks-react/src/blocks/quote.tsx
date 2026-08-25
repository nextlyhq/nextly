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

  const blockquote = (
    <blockquote {...(citeUrl === undefined ? {} : { cite: citeUrl })}>
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
      <figcaption>
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
export const quote = defineBlock<QuoteProps, PageContext>({
  name: "core/quote",
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
