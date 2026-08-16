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
 * that display is a style rather than a block, and a default that cannot be
 * overridden is the Elementor V4 padding complaint in another costume. A row
 * that an author restyles into a stack at one breakpoint is still a row of
 * columns, and nothing here has to know.
 *
 * @module blocks/library/columns
 */
import type { BlockNode } from "@nextlyhq/blocks-engine";
import { defineBlock } from "@nextlyhq/blocks-engine";

import type { PageContext } from "../context";

import {
  COLUMN_BLOCK,
  COLUMN_DEFAULT_PROPS,
  COLUMN_VERSION,
  COLUMNS_BLOCK,
} from "./column";
import { renderContainer } from "./container";
import type { ContainerProps } from "./container";

export { COLUMN_BLOCK, COLUMNS_BLOCK } from "./column";

/**
 * How many columns a freshly placed row starts with.
 *
 * Two rather than one, because a row of one is a box and an author who wanted
 * a box would have reached for one; and rather than three, because removing a
 * column is a click and adding one is a decision.
 */
const INITIAL_COLUMNS = 2;

/**
 * The id prefix marking a template node as a PLACEHOLDER.
 *
 * A template describes what to create, not a thing that exists, so an id here
 * is a slot for a real one rather than an identity. **An expansion path must
 * mint a fresh id per node per instance** — two rows on one page seeded with
 * the same literal ids would collide, and the engine reports that as
 * `duplicate-node-id` on the second row.
 *
 * Named rather than inlined so a consumer can assert it never reaches a stored
 * document. `template` currently has NO reader anywhere in the repository, so
 * the requirement is stated here for whoever writes the first one.
 */
export const TEMPLATE_PLACEHOLDER_ID = "core-columns-placeholder";

/**
 * A column node for the initial template.
 *
 * Returns `BlockNode` rather than a shape typed by `ContainerProps`: a stored
 * node's props are an open record, and `ContainerProps` is a named interface,
 * which TypeScript will not treat as one. The literal is checked against the
 * block's own prop names by validation — the layer that owns that question —
 * rather than by a cast here.
 *
 * **The version and props are IMPORTED from `column.tsx`, never restated.**
 * A template that seeds nodes at a version or with defaults the block no
 * longer declares makes row-seeded columns start in a different schema state
 * from columns inserted directly, and nothing would report the divergence.
 */
function templateColumn(index: number): BlockNode {
  return {
    id: `${TEMPLATE_PLACEHOLDER_ID}-${index}`,
    type: COLUMN_BLOCK,
    version: COLUMN_VERSION,
    props: { ...COLUMN_DEFAULT_PROPS },
  };
}

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
      template: Array.from({ length: INITIAL_COLUMNS }, (_, i) =>
        templateColumn(i)
      ),
    },
  },
  // The row layout, as an overridable default rather than a rule in the
  // renderer. This is what `baseStyles` is for, and a row is its first real
  // consumer.
  baseStyles: { base: { base: { display: "flex" } } },
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
