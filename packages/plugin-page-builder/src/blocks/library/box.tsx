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
import { defineBlock } from "@nextlyhq/plugin-sdk/blocks";

import { renderContainer } from "./container";
import type { ContainerProps } from "./container";

export const box = defineBlock<ContainerProps>({
  name: "core/box",
  version: 1,
  description:
    "A generic container. Full width with no padding of its own; use display to make it a flex row, a stack, or a grid.",
  props: {
    as: { type: "select", options: ["div", "article", "aside"] },
  },
  defaultProps: { as: "div", contained: false },
  example: { props: { as: "div" } },
  slots: {
    children: { template: [] },
  },
  supports: {
    spacing: true,
    layout: true,
    dimensions: true,
    background: true,
    border: true,
    effects: true,
    position: true,
    container: true,
  },
  render: renderContainer,
});
