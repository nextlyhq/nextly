/**
 * `core/rich-text` — a passage with formatting inside it.
 *
 * The counterpart to `core/text`, which holds a plain string. Bold inside a
 * sentence, a link mid-paragraph, a list, a heading between two paragraphs: all
 * of those are one value here rather than a block each, because they are one
 * passage to the person who wrote them.
 *
 * ## It draws the value, it does not define how
 *
 * The stored shape, the format bits and the walk that turns a tree into
 * elements all live outside this file — the shape in the engine, the walk in
 * {@link module:rich-text}. This block is the registration that puts them on a
 * page, and it deliberately holds no reading rules of its own: a second reader
 * of one format is how two surfaces come to disagree about what a node means,
 * and the disagreement is silent on both.
 *
 * That is also why the value reaches the renderer unnarrowed. `RichText` takes
 * `unknown` and draws nothing for a value that is not rich text, so a prop
 * holding a string left by an older document, or a null, renders empty instead
 * of throwing on a live page.
 *
 * @module blocks/rich-text
 */
import {
  defineBlock,
  isRichTextValue,
  RICH_TEXT_PROP_TYPE,
  richTextToPlainText,
  type RichTextValue,
} from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";

import type { BlockRenderArgs, PageContext } from "../context";
import { RichText } from "../rich-text";

import { CONTENT } from "./categories";

export interface RichTextBlockProps {
  /** The passage, as the editor serialized it. */
  content?: RichTextValue;
}

/**
 * Freezes a value and everything inside it, returning the same value.
 *
 * `Object.freeze` is one level deep, so freezing a tree's root leaves every
 * node under it writable — which is the opposite of useful for a default whose
 * whole risk lives in its children.
 */
function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

/**
 * What a newly inserted block holds.
 *
 * One empty paragraph rather than no children, because that is what an editor
 * hands back for an empty passage and because a root with nothing in it renders
 * to nothing at all — leaving an author a block they can see in the layers
 * panel and cannot put a caret into on the canvas.
 *
 * FROZEN, and deeply, because the inserter spreads `defaultProps` one level
 * deep: every node inserted from this definition would otherwise share this
 * exact object, and one in-place edit would rewrite the passage of every other
 * block inserted from it. Nothing here mutates a stored value — a commit builds
 * a fresh tree — so the freeze guards a mistake rather than a current path, and
 * it fails at the moment of the mistake instead of quietly later.
 */
const EMPTY_PASSAGE: RichTextValue = deepFreeze({
  root: {
    type: "root" as const,
    children: [{ type: "paragraph", children: [] }],
  },
});

export function renderRichText({
  props,
  className,
  markProp,
  hostPolicy,
}: BlockRenderArgs<RichTextBlockProps>): ReactElement {
  /*
   * The wrapper carries both the class and the mark, so the element an author
   * puts a caret into is the element the block's styles apply to. Marking an
   * inner element instead would edit a passage whose padding and colour sit on
   * a parent the editor never told anyone about.
   */
  return (
    <div className={className} {...markProp?.("content")}>
      <RichText value={props.content} hostPolicy={hostPolicy} />
    </div>
  );
}

// Defined against the ENGINE's `defineBlock`, not the plugin SDK's: the engine
// declares the contract and the SDK re-exports it for third parties. The
// context is named rather than augmented, so a block compiled against the
// published types is typed the same as one compiled here. See `./index.ts`.
export const richText = defineBlock<RichTextBlockProps, PageContext>({
  name: "core/rich-text",
  version: 1,
  description:
    "A passage of formatted text: bold and links within a sentence, lists, and headings between paragraphs, all held as one value.",
  // Palette metadata. The category is imported rather than spelled here so
  // nineteen blocks cannot drift into nineteen headings; keywords are what
  // let a search for a word the description never uses still find this.
  editor: {
    label: "Rich text",
    icon: "text",
    category: CONTENT,
    keywords: ["rich text", "formatted", "prose", "wysiwyg", "editor"],
  },
  props: { content: { type: RICH_TEXT_PROP_TYPE, inline: true } },
  defaultProps: { content: EMPTY_PASSAGE },
  /*
   * The words, with the formatting dropped. Taken from the engine's own
   * flattener rather than a walk written here: a description that disagreed
   * with the page would be the one a crawler quotes, and nothing on the page
   * would show the disagreement.
   *
   * Guarded because `props` is whatever the document stored, and the flattener
   * takes a value already known to be rich text.
   */
  seo: props =>
    isRichTextValue(props.content)
      ? { description: richTextToPlainText(props.content) }
      : undefined,
  example: {
    props: {
      content: {
        root: {
          type: "root",
          children: [
            {
              type: "paragraph",
              children: [
                {
                  type: "text",
                  text: "A passage of formatted text.",
                  format: 0,
                },
              ],
            },
          ],
        },
      },
    },
  },
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
  render: renderRichText,
});
