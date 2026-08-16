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
 * **This module owns both halves' names and the column's own defaults**, so
 * `columns.tsx` imports from here and never the reverse. A cycle between the
 * two would be avoidable only by restating a value, which is the thing the
 * arrangement exists to prevent.
 *
 * @module blocks/library/column
 */
import { defineBlock } from "@nextlyhq/blocks-engine";

import type { PageContext } from "../context";

import { renderContainer } from "./container";
import type { ContainerProps } from "./container";

/** The block name a `core/columns` slot accepts, in one place. */
export const COLUMN_BLOCK = "core/column";

/** The block name a `core/column` may sit inside, in one place. */
export const COLUMNS_BLOCK = "core/columns";

/**
 * The column's schema version, named so a row's slot template cannot drift
 * from it. A template that seeds nodes at a version the block no longer
 * declares makes row-seeded columns start in a different schema state from
 * columns inserted directly, and nothing would report it.
 */
export const COLUMN_VERSION = 1;

/** What a column starts as, wherever it is created from. */
export const COLUMN_DEFAULT_PROPS: ContainerProps = {
  as: "div",
  contained: false,
};

/**
 * The flex-item defaults a column needs to behave like one.
 *
 * Without these a column is an ordinary flex item: `flex: 0 1 auto` and
 * `min-width: auto`. Empty seeded columns then collapse to nothing, populated
 * ones size from their content rather than sharing the row, and a single long
 * unbroken child forces the row to overflow. A row whose columns vanish on
 * insert is not a usable default.
 *
 * `1 1 240px` grows and shrinks from a sensible basis; `minWidth: 0` is the
 * flex-item override that lets a column shrink below its content, which is
 * what stops the overflow. Both are `baseStyles` rather than rules in the
 * renderer, so an author can override either — the same reason `columns.tsx`
 * keeps the row's `display` overridable.
 *
 * These values match `plugin-page-builder`'s existing column implementation
 * deliberately: two behaviours for one block is the divergence this program
 * keeps producing.
 */
export const COLUMN_BASE_STYLES = {
  base: { base: { flex: "1 1 240px", minWidth: 0 } },
} as const;

export const column = defineBlock<ContainerProps, PageContext>({
  name: COLUMN_BLOCK,
  version: COLUMN_VERSION,
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
  defaultProps: COLUMN_DEFAULT_PROPS,
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
  baseStyles: COLUMN_BASE_STYLES,
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
