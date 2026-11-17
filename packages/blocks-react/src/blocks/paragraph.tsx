/**
 * `core/text` — a paragraph.
 *
 * One paragraph of words, with bold, italic, links and line breaks inside it.
 * Headings, lists and quotes belong to the rich-text block; keeping them apart
 * means a short caption cannot quietly carry a heading into a page's outline.
 *
 * ## What it stores
 *
 * Version 2 stores the words as a one-paragraph rich value
 * (`toOneParagraph`), the format the rich-text block stores, restricted to
 * those three marks and line breaks. Version 1 stored a plain string; its
 * upgrade reads the string as the paragraph, each `\n` a line break, so an
 * older Text loses nothing.
 *
 * The restriction is applied when the value is READ as well as when the editor
 * writes it: whatever a document holds there — an older string, a value bound
 * from a text field, a value written by an import with a heading in it — is
 * drawn as one paragraph of its words and the three marks, never as more.
 *
 * The prop's TYPE stays the one a line of words has, so a binding fills it
 * from a text field (never a rich-text one) and a component exposes it as
 * text. `oneParagraph` is what tells the editor and this renderer the value
 * may carry the marks.
 *
 * @module blocks/paragraph
 */
import {
  type BlockDefinition,
  defineBlock,
  ONE_PARAGRAPH_OPTION,
  oneParagraphWords,
  toOneParagraph,
} from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";

import type { BlockRenderArgs, PageContext } from "../context";
import { drawsInteractive, RichTextParagraphContent } from "../rich-text";

import { CONTENT } from "./categories";
import { boundText, text } from "./props";

export interface ParagraphProps {
  /**
   * The paragraph: a one-paragraph rich value. A string, as version 1 stored
   * it and as a binding fills it, is read as the paragraph's words.
   */
  text?: unknown;
}

export function renderParagraph({
  props,
  className,
  markProp,
  bound,
}: BlockRenderArgs<ParagraphProps>): ReactElement {
  // A bound date keeps its machine-readable value: the binding filled the prop
  // with the formatted words, which are drawn inside a `<time>`.
  if (bound?.text?.kind === "date") {
    return (
      <p className={className} {...markProp?.("text")}>
        {boundText(text(props.text), bound.text)}
      </p>
    );
  }
  return (
    <p className={className} {...markProp?.("text")}>
      <RichTextParagraphContent value={toOneParagraph(props.text).value} />
    </p>
  );
}

/** An empty Text: one paragraph with no words. */
const EMPTY_TEXT = toOneParagraph("").value;

// Defined against the ENGINE's `defineBlock`, not the plugin SDK's: the engine
// declares the contract and the SDK re-exports it for third parties. The
// context is named rather than augmented, so a block compiled against the
// published types is typed the same as one compiled here. See `./index.ts`.
export const paragraph: BlockDefinition<ParagraphProps, PageContext> =
  defineBlock({
    name: "core/text",
    version: 2,
    // Version 1 held the words as a string. Read as the paragraph, each `\n` a
    // line break; a value already rich (a node an editor wrote before its
    // version was raised) is restricted the same way, so the step is safe to
    // run on anything a version-1 node can hold.
    migrate: {
      1: props => ({ ...props, text: toOneParagraph(props.text).value }),
    },
    // What an author reads, in the Add panel and the block card: one plain
    // line. What the block does, for whoever maintains it: one paragraph, with
    // bold, italic and links inside it. Headings and lists live in the
    // rich-text block.
    description: "A paragraph, with bold, italic and links.",
    // Palette metadata. The category is imported rather than spelled here so
    // nineteen blocks cannot drift into nineteen headings; keywords are what
    // let a search for a word the description never uses still find this.
    editor: {
      label: "Text",
      icon: "text",
      category: CONTENT,
      keywords: ["paragraph", "copy", "body", "prose"],
    },
    props: {
      text: {
        label: "Text",
        role: "content",
        type: "textarea",
        inline: true,
        [ONE_PARAGRAPH_OPTION]: true,
      },
    },
    defaultProps: { text: EMPTY_TEXT },
    // The opening prose is what a search result should quote. Offered whole and
    // untruncated: how long a description may be is the metadata layer's rule,
    // and a block trimming to its own guess would fight it.
    // Normalized as the render does, for the same reason the heading is.
    seo: props => ({ description: oneParagraphWords(props.text) }),
    example: { props: { text: toOneParagraph("A paragraph of text.").value } },
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
    // A Text drawing a link is interactive while it does, decided the way the
    // renderer decides what it draws, so it cannot be placed where a link
    // cannot go (inside a linked card).
    contentModel: props =>
      drawsInteractive(toOneParagraph(props.text).value.root.children)
        ? { is: ["flow", "interactive"] }
        : { is: ["flow"] },
    render: renderParagraph,
  });
