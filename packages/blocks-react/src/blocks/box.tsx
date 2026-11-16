/**
 * `core/box` — the one generic container.
 *
 * A preset over the same implementation `core/section` uses: a plain element,
 * full width, no content-width constraint and no padding. Display is a style
 * rather than a block, so a flex box and a grid box are the same block with a
 * different `display` value. That is deliberately the merge of Bricks' Block
 * and Div and of Elementor V4's Div and Flexbox, both of which their own
 * communities ask "why are there two of these?".
 *
 * @module blocks/library/box
 */
import { type BlockDefinition, defineBlock } from "@nextlyhq/blocks-engine";

import type { PageContext } from "../context";

import { LAYOUT } from "./categories";
import {
  CONTAINER_CHILD_GAP,
  CONTAINER_SUPPORTS,
  LINKABLE_BASE_STYLE,
  linkableContentModel,
  renderLinkableContainer,
} from "./container";
import type { ContainerProps } from "./container";
import { htmlTagProp } from "./html-tags";

// Defined against the ENGINE's `defineBlock`, not the plugin SDK's: the engine
// declares the contract and the SDK re-exports it for third parties. The
// context is named rather than augmented, so a block compiled against the
// published types is typed the same as one compiled here. See `./index.ts`.
export const box: BlockDefinition<ContainerProps, PageContext> = defineBlock({
  name: "core/box",
  version: 1,
  // What an author reads, in the Add panel and the block card: one plain line.
  // What the block does, for whoever maintains it: A generic container. Full
  // width with no padding of its own; use display to make it a flex row, a
  // stack, or a grid.
  description: "A plain container for grouping blocks.",
  // Palette metadata. The category is imported rather than spelled here so
  // nineteen blocks cannot drift into nineteen headings; keywords are what
  // let a search for a word the description never uses still find this.
  editor: {
    label: "Box",
    icon: "container",
    category: LAYOUT,
    keywords: ["container", "div", "group", "wrapper"],
  },
  props: {
    as: htmlTagProp(["div", "article", "aside"]),
    // Declared even though a box is full width by default: a preset differs
    // from its sibling in what it starts as, never in what it can be told to
    // do, and a schema is what lets anything but a human change a value.
    contained: { label: "Constrain content width", type: "checkbox" },
    // A whole-block link. Content, because where a box leads is what an
    // editor changes; the block reads it through `url()` like Heading and
    // Button, so an unusable value renders no link and makes nothing
    // interactive.
    link: { label: "Link", role: "content", type: "url" },
  },
  defaultProps: { as: "div", contained: false },
  example: { props: { as: "div" } },
  slots: {
    // No declared starting children: a box is a general-purpose container with
    // no allow-list, so there is no child type it exists to hold and nothing to
    // default to that would be righter than empty.
    children: {},
  },
  baseStyles: { base: { base: LINKABLE_BASE_STYLE } },
  childGap: CONTAINER_CHILD_GAP,
  supports: CONTAINER_SUPPORTS,
  // A linked box is an `<a>`, so what may sit inside it follows its link.
  contentModel: linkableContentModel,
  render: renderLinkableContainer,
});
