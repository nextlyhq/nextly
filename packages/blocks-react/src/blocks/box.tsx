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
import { defineBlock } from "@nextlyhq/blocks-engine";

import type { PageContext } from "../context";

import { LAYOUT } from "./categories";
import { CONTAINER_SUPPORTS, renderContainer } from "./container";
import type { ContainerProps } from "./container";

// Defined against the ENGINE's `defineBlock`, not the plugin SDK's: the engine
// declares the contract and the SDK re-exports it for third parties. The
// context is named rather than augmented, so a block compiled against the
// published types is typed the same as one compiled here. See `./index.ts`.
export const box = defineBlock<ContainerProps, PageContext>({
  name: "core/box",
  version: 1,
  description:
    "A generic container. Full width with no padding of its own; use display to make it a flex row, a stack, or a grid.",
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
    as: { type: "select", options: ["div", "article", "aside"] },
    // Declared even though a box is full width by default: a preset differs
    // from its sibling in what it starts as, never in what it can be told to
    // do, and a schema is what lets anything but a human change a value.
    contained: { type: "checkbox" },
  },
  defaultProps: { as: "div", contained: false },
  example: { props: { as: "div" } },
  slots: {
    // No declared starting children: a box is a general-purpose container with
    // no allow-list, so there is no child type it exists to hold and nothing to
    // default to that would be righter than empty.
    children: {},
  },
  supports: CONTAINER_SUPPORTS,
  render: renderContainer,
});
