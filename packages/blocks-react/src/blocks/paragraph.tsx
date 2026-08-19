/**
 * `core/text` — a paragraph.
 *
 * Plain text, not rich text. Bold, links inside a sentence and lists belong to
 * the rich-text block, which brings an editor with it; keeping them apart means
 * a page that needs one short line does not load one. Line breaks in the stored
 * value are preserved by CSS rather than by splitting into elements, so the
 * document holds what the author typed.
 *
 * @module blocks/paragraph
 */
import { defineBlock } from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";

import type { BlockRenderArgs, PageContext } from "../context";

import { CONTENT } from "./categories";
import { text } from "./props";

export interface ParagraphProps {
  /** The paragraph's text. */
  text?: string;
}

export function renderParagraph({
  props,
  className,
  markProp,
}: BlockRenderArgs<ParagraphProps>): ReactElement {
  return (
    <p className={className} {...markProp?.("text")}>
      {text(props.text)}
    </p>
  );
}

// Defined against the ENGINE's `defineBlock`, not the plugin SDK's: the engine
// declares the contract and the SDK re-exports it for third parties. The
// context is named rather than augmented, so a block compiled against the
// published types is typed the same as one compiled here. See `./index.ts`.
export const paragraph = defineBlock<ParagraphProps, PageContext>({
  name: "core/text",
  version: 1,
  description:
    "A paragraph of plain text. Rich formatting lives in the rich-text block, which carries its own editor.",
  // Palette metadata. The category is imported rather than spelled here so
  // nineteen blocks cannot drift into nineteen headings; keywords are what
  // let a search for a word the description never uses still find this.
  editor: {
    label: "Text",
    category: CONTENT,
    keywords: ["paragraph", "copy", "body", "prose"],
  },
  props: { text: { type: "textarea", inline: true } },
  defaultProps: { text: "" },
  // The opening prose is what a search result should quote. Offered whole and
  // untruncated: how long a description may be is the metadata layer's rule,
  // and a block trimming to its own guess would fight it.
  // Normalized as the render does, for the same reason the heading is.
  seo: props => ({ description: text(props.text) }),
  example: { props: { text: "A paragraph of text." } },
  supports: {
    typography: true,
    color: true,
    spacing: true,
    dimensions: true,
    background: true,
    border: true,
    effects: true,
    position: true,
  },
  render: renderParagraph,
});
