/**
 * `core/columns` — a row of columns, and the only block that restricts its slot.
 *
 * A preset over the same implementation `core/section` and `core/box` use. It
 * differs from a box in exactly two ways, and both are relationships rather
 * than capabilities: it starts laid out as a row, and its slot accepts only
 * `core/column`. Nothing it can be told to do is unavailable to a box.
 *
 * **Why a pair of blocks rather than a box with a flex display.** The pair is
 * what makes each column ADDRESSABLE. An anonymous child created by the row's
 * own renderer has no node id, so it has no scoped class, so it cannot be
 * selected, styled, targeted by a drop, or named in a rule. Giving the child a
 * block name buys identity; it deliberately buys nothing else.
 *
 * **Unequal columns are set on the ROW, not on a column.** In a grid the track
 * list allocates the width, so a `width` style on a column resizes the ITEM
 * inside its track and leaves the track alone — it cannot produce a 70/30
 * layout. An author makes one column wider by editing this row's
 * `grid-template-columns` (a catalog property this block supports through
 * `layout`), e.g. `7fr 3fr`. Stated because the opposite is the natural
 * assumption, and because a per-column `width` will look like it did nothing.
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

import { LAYOUT } from "./categories";
import { COLUMN_BLOCK, COLUMNS_BLOCK } from "./column";
import { CONTAINER_SUPPORTS, renderContainer } from "./container";
import type { ContainerProps } from "./container";

export { COLUMN_BLOCK, COLUMNS_BLOCK } from "./column";

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
      // `min(240px, 100%)` rather than a bare `240px`. `auto-fit` collapses
      // empty tracks but never drops the LAST one, so a flat minimum makes a
      // single remaining track overflow any container narrower than it —
      // reachable in a nested row or a narrow embed, and not saved by the
      // column's `min-width: 0`, which governs the item rather than the track.
      // Capping the minimum by the available width lets that last track fit.
      gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))",
      /*
       * The gutter between columns, which this block laid out and then left at
       * zero.
       *
       * `gap` on a grid defaults to `normal`, which computes to zero — so the
       * one block whose whole purpose is side-by-side content rendered its
       * columns touching. Measured on a published page: three tracks of 427px
       * with no space between them.
       *
       * A TOKEN reference, which it could not have been until now. `core/gallery`
       * and `core/accordion` both shipped `{ $token: "space.4" }`, rendered their
       * children touching, and were changed to the literal `1rem` — because
       * nothing turned a token set into CSS, so the reference compiled to a
       * `var()` with nothing behind it and `gap` fell back to `normal`. Each of
       * the three said the literal stood "until `compileSiteSheet` is wired into
       * the render path", and it now is: `PageRenderer` compiles a site sheet by
       * default, so a rendered page defines `--site-space-4: 1rem`. The default
       * is therefore unchanged and a site that retunes its spacing scale now
       * reaches the gutter instead of finding a second answer here.
       */
      gap: { $token: "space.4" },
    },
  },
} as const;

export const columns = defineBlock<ContainerProps, PageContext>({
  name: COLUMNS_BLOCK,
  version: 1,
  description:
    "A row of columns. Restricts its slot to core/column so each column keeps an identity that can be selected and styled.",
  // Palette metadata. The category is imported rather than spelled here so
  // nineteen blocks cannot drift into nineteen headings; keywords are what
  // let a search for a word the description never uses still find this.
  editor: {
    label: "Columns",
    icon: "columns",
    category: LAYOUT,
    keywords: ["row", "grid", "split", "side by side"],
  },
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
       * The two columns a freshly placed row starts with.
       *
       * A row must start with children at all, because this slot admits only
       * `core/column` and that block names this one as its only parent — so an
       * empty row is a container whose single legal child can be placed nowhere
       * else on the page, and the author has to build both halves by hand.
       *
       * Two rather than one, because a row of one is a box and an author who
       * wanted a box would have reached for one; and rather than three, because
       * removing a column is a click and adding one is a decision.
       *
       * The entries are written out rather than repeated from a count. Each
       * declares one child, so an unequal split — a different width per column —
       * is a change to an entry rather than a change of shape, and this list is
       * the only place the number lives.
       */
      defaultBlock: [{ type: COLUMN_BLOCK }, { type: COLUMN_BLOCK }],
    },
  },
  baseStyles: COLUMNS_BASE_STYLES,
  supports: CONTAINER_SUPPORTS,
  render: renderContainer,
});
