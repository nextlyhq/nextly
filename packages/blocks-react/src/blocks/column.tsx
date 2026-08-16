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
 * ⚠ A COLUMN SHIPS NO DEFAULT LAYOUT, and it is not for want of trying.
 *
 * A column wants flex-item defaults — `flex: 1 1 240px` and `min-width: 0`, as
 * `plugin-page-builder/src/render/blocks/column.tsx` supplies — because an
 * ordinary flex item keeps `flex: 0 1 auto` and `min-width: auto`, so an empty
 * column collapses and a long unbroken child overflows the row.
 *
 * **There is no mechanism to deliver them.** Measured on this package:
 * `baseStyles` is declared on `BlockDefinition` (`block.ts:211`) and read by
 * NOTHING — zero non-test consumers anywhere in the repository — and
 * `blocks-react` ships no stylesheet of its own (confirmed against
 * `plugin-page-builder`, which does, so the search was capable of finding one).
 * A `baseStyles` declaration here would compile to nothing and render as
 * nothing, while reading in review as a working default.
 *
 * Shipping one anyway would add another capability that reaches nothing, which
 * is the pattern this package already carries seven instances of. So the pair
 * ships what it can actually deliver — identity, the nesting rule and the
 * template — and the author styles the row through the inspector until block
 * default styles have a delivery path.
 *
 * Note also that the catalog has flex CONTAINER properties (`flexDirection`,
 * `flexWrap`, `justifyContent`, `alignItems`, `gap`) and **no flex ITEM
 * properties at all** — no `flex`, `flexGrow`, `flexShrink` or `flexBasis`.
 * So wiring `baseStyles` alone would not be enough; the catalog needs the
 * properties too, or the row has to size its children with
 * `gridTemplateColumns`, which the catalog does support.
 */

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
  supports: CONTAINER_SUPPORTS,
  render: renderContainer,
});
