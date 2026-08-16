/**
 * `core/column` — one column of a row.
 *
 * A preset over the same implementation `core/box` uses, and the child half of
 * the only nesting rule in the catalogue. It exists to give a column an
 * IDENTITY — a node id, and therefore a scoped class, a selection target and a
 * drop target — not to give it a capability a box lacks. See `columns.tsx` for
 * why that distinction is the one Elementor V3 got wrong.
 *
 * **It carries no width prop, deliberately.** Width is a style, and the style
 * catalog already expresses it per breakpoint; a `width` prop would be a
 * second way to say the same thing, disagreeing with the first at whichever
 * breakpoint nobody checked. `container.tsx` makes the same call for padding.
 *
 * @module blocks/library/column
 */
import { defineBlock } from "@nextlyhq/blocks-engine";

import type { PageContext } from "../context";

import { COLUMNS_BLOCK } from "./columns";
import { renderContainer } from "./container";
import type { ContainerProps } from "./container";

export const column = defineBlock<ContainerProps, PageContext>({
  name: "core/column",
  version: 1,
  description:
    "One column of a core/columns row. A container with an identity, so it can be selected, styled and dropped into.",
  props: {
    // Narrower than a box's list: a column is a layout child, and `aside` or
    // `article` inside a row is nearly always a mistake the author meant to
    // make one level up. Anything genuinely semantic belongs in the column
    // rather than as the column.
    as: { type: "select", options: ["div"] },
    contained: { type: "checkbox" },
  },
  defaultProps: { as: "div", contained: false },
  example: { props: { as: "div" } },
  /**
   * The CHILD half of the nesting rule, stated here rather than inferred from
   * `core/columns`' allow-list.
   *
   * `block.ts` is explicit that neither half implies the other, and this is the
   * direction that matters for the editor: without it a column is insertable
   * anywhere, and an author who drops one onto the page root gets a container
   * that looks like a box, is styled like a box, and is silently governed by a
   * row that is not there.
   */
  parent: [COLUMNS_BLOCK],
  // An unrestricted slot: a column holds anything a page holds. The row
  // restricts what may be a COLUMN; it says nothing about what a column holds.
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
