/**
 * `core/columns` — a row of columns, and the only block that restricts its slot.
 *
 * A preset over the same implementation `core/section` and `core/box` use. It
 * differs from a box in exactly two ways, and both are relationships rather
 * than capabilities: it starts laid out as a row, and its slot accepts only
 * `core/column`. Nothing it can be told to do is unavailable to a box.
 *
 * **Why a pair of blocks rather than a box with a flex display.** The pair is
 * what makes each column ADDRESSABLE. An anonymous flex child created by the
 * row's own renderer has no node id, so it has no scoped class, so it cannot
 * be selected, styled, targeted by a drop, or named in a rule — and the author
 * who wants one column wider than another has nowhere to put that. Giving the
 * child a block name buys identity; it deliberately buys nothing else.
 *
 * That is the distinction `container.tsx` draws when it rejects Elementor V3's
 * Section/Column: what broke live sites there was columns with CAPABILITIES a
 * div lacked, so a migration had to rewrite structure. Here a column is a
 * container preset, and the only thing a box cannot do is be a column's
 * identity. Gutenberg reaches the same split for the same reason — its
 * `core/column` declares `parent: ["core/columns"]`, which is the arrangement
 * `block.ts` names when it documents this field.
 *
 * **The layout is `baseStyles`, not a hardcode.** `container.tsx` establishes
 * that display is a style rather than a block, and a default nobody can
 * override is the Elementor V4 padding complaint in another costume.
 * `styles.ts`'s `blockBasesFor` derives these per block TYPE and hands them to
 * `compilePageCss`, so one rule is emitted for the type rather than copied
 * into every node.
 *
 * **It is a GRID rather than a flex row, and the catalog decides that.** The
 * compiler rejects properties it does not know, and `STYLE_CATALOG` carries
 * flex CONTAINER properties but no flex ITEM ones — no `flex`, `flexGrow`,
 * `flexShrink`, `flexBasis` — so a flex row could not size its children at
 * all. `grid-template-columns` is supported, and it puts the sizing on the
 * track list where one declaration governs every column.
 *
 * `repeat(auto-fit, minmax(240px, 1fr))` gives equal columns that share the
 * row, and wraps to a new line below the minimum instead of crushing them.
 * That is the responsive behaviour an author would otherwise write a media
 * query for, and it is overridable like any other default.
 *
 * @module blocks/library/columns
 */
import { defineBlock } from "@nextlyhq/blocks-engine";

import type { PageContext } from "../context";

import { COLUMN_BLOCK, COLUMNS_BLOCK } from "./column";
import { CONTAINER_SUPPORTS, renderContainer } from "./container";
import type { ContainerProps } from "./container";

export { COLUMN_BLOCK, COLUMNS_BLOCK } from "./column";

/**
 * How many columns a freshly placed row starts with.
 *
 * Two rather than one, because a row of one is a box and an author who wanted
 * a box would have reached for one; and rather than three, because removing a
 * column is a click and adding one is a decision.
 */
export const INITIAL_COLUMNS = 2;

/**
 * The row's default layout, in properties the compiler actually accepts.
 *
 * `auto-fit` collapses empty tracks and `minmax(240px, 1fr)` makes every
 * remaining column an equal share of the row that will not go below 240px —
 * so columns share the width, and wrap to a new line rather than being
 * crushed. Both `display` and `gridTemplateColumns` are in `STYLE_CATALOG`;
 * an unlisted property is dropped by the compiler rather than passed through.
 */
export const COLUMNS_BASE_STYLES = {
  base: {
    base: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    },
  },
} as const;

export const columns = defineBlock<ContainerProps, PageContext>({
  name: COLUMNS_BLOCK,
  version: 1,
  description:
    "A row of columns. Restricts its slot to core/column so each column keeps an identity that can be selected and styled.",
  props: {
    as: { type: "select", options: ["div", "section", "article"] },
    contained: { type: "checkbox" },
  },
  defaultProps: { as: "div", contained: false },
  example: { props: { as: "div" } },
  // The parent half of the nesting rule. `block.ts` is explicit that this does
  // NOT imply the child half: a slot naming a type must not confine that type
  // to it. `core/column` states its own side in `column.tsx`.
  slots: {
    children: {
      allow: [COLUMN_BLOCK],
      /**
       * EMPTY, deliberately, until something expands templates.
       *
       * A seeded template needs its ids minted per INSTANCE: two rows
       * expanded from one literal template carry the same node ids, and the
       * engine reports `duplicate-node-id` on the second. Nothing in the
       * repository reads `SlotSpec.template`, so there is no expansion path
       * to do that minting — and shipping nodes whose ids are correct only if
       * a future reader remembers to replace them is a trap rather than a
       * default.
       *
       * Naming the ids "placeholders" was the first attempt and it changed no
       * behaviour: the collision is a property of the nodes, not of what they
       * are called. An empty template makes it unreachable instead.
       *
       * The two-column default belongs with the expander, which is the layer
       * that can mint ids. `INITIAL_COLUMNS` records the intended number so
       * that work does not have to re-derive it.
       */
      template: [],
    },
  },
  baseStyles: COLUMNS_BASE_STYLES,
  supports: CONTAINER_SUPPORTS,
  render: renderContainer,
});
