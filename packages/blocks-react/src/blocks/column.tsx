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

import { CONTAINER_SUPPORTS, renderContainer } from "./container";
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
 * What a column needs to stop its content forcing the row wider.
 *
 * A grid item defaults to `min-width: auto`, which floors its track at the
 * widest unbreakable content — one long URL then pushes the whole row into
 * horizontal overflow. `min-width: 0` lets the track shrink as the row asks.
 *
 * **Sizing lives on the ROW, not here.** `columns.tsx` uses
 * `grid-template-columns`, so equal sizing is a property of the track list and
 * each column needs no width of its own. That also keeps the pair honest about
 * differing in relationships rather than capabilities: a column declares no
 * dimension a box could not.
 *
 * Every property here is in `STYLE_CATALOG`. The compiler REJECTS unknown
 * properties rather than passing them through, so a declaration naming one is
 * silently dropped — and the catalog has flex CONTAINER properties but **no
 * flex ITEM properties at all** (no `flex`, `flexGrow`, `flexShrink`,
 * `flexBasis`), which is why this is a grid rather than the flex layout the
 * PoC column uses.
 */
export const COLUMN_BASE_STYLES = {
  base: { base: { minWidth: 0 } },
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
  supports: CONTAINER_SUPPORTS,
  render: renderContainer,
});
