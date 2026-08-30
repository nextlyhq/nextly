/**
 * `core/list` — an ordered or unordered list.
 *
 * Items are stored as an array of strings and rendered as real `<li>` elements,
 * so the list is announced with its length and position ("item 2 of 5"). A
 * paragraph of manually typed bullets loses all of that.
 *
 * @module blocks/list
 */
import { defineBlock } from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";

import type { BlockRenderArgs, PageContext } from "../context";

import { CONTENT } from "./categories";
import { number, oneOf, text } from "./props";

export const LIST_KINDS = ["unordered", "ordered"] as const;

/**
 * How many items are rendered from one stored list.
 *
 * A stored array has no length of its own — the document's caps bound node count
 * and depth, never a prop array — so `items` arrives at whatever length was
 * written. Past the renderer's own inspection budget the normalizer refuses the
 * whole output, and the block becomes a broken-block placeholder: an
 * accidentally long list loses EVERY item rather than the ones past the end.
 *
 * Clamping trades the tail for the body, which is the better failure by a wide
 * margin. The number sits far above any list a person writes and far below the
 * budget, so the block still has room for its wrapper and nothing hand-authored
 * ever reaches it.
 */
const MAX_ITEMS = 1_000;

export interface ListProps {
  /** Whether the order of the items is meaningful. */
  kind?: "unordered" | "ordered";
  /** The items, in order. */
  items?: string[];
  /** The first number of an ordered list. */
  start?: number;
}

export function renderList({
  props,
  className,
}: BlockRenderArgs<ListProps>): ReactElement {
  // A stored array can hold anything, and a non-string item would reach React
  // as a child it cannot render. Coerced rather than dropped, so an item typed
  // as a number still appears where its author put it.
  const stored: unknown = props.items;
  // Sliced BEFORE the map, so an oversized array is never walked in full: the
  // work this bounds is the work of reading it, not just of rendering it.
  const items = Array.isArray(stored)
    ? stored.slice(0, MAX_ITEMS).map(item => text(item))
    : [];
  const children = items.map((item, index) => (
    // The index is the key because the items have no identity of their own:
    // they are strings in an array, and two identical strings are the same
    // value. Reordering re-renders the text, which is all there is to preserve.
    <li key={index}>{item}</li>
  ));

  if (oneOf(props.kind, LIST_KINDS, "unordered") === "ordered") {
    const start = number(props.start, { min: 1, max: 1_000_000, fallback: 1 });
    return (
      <ol className={className} {...(start === 1 ? {} : { start })}>
        {children}
      </ol>
    );
  }
  return <ul className={className}>{children}</ul>;
}

// Defined against the ENGINE's `defineBlock`, not the plugin SDK's: the engine
// declares the contract and the SDK re-exports it for third parties. The
// context is named rather than augmented, so a block compiled against the
// published types is typed the same as one compiled here. See `./index.ts`.
/**
 * What restores a list's markers after a reset has removed them.
 *
 * A list without markers is not a plainer list, it is a stack of paragraphs:
 * the one thing that distinguishes an item from a line of text is gone, and the
 * reader loses the grouping the markup still claims. Tailwind's Preflight sets
 * `list-style: none` on every `ul` and `ol` and says so in a comment, and this
 * library's own scaffold imports it — so on a site built from `create-nextly-app`
 * this is a repair rather than a decoration.
 *
 * **`revert` rather than a marker, because one rule serves two elements.** This
 * block renders `<ul>` or `<ol>` from a PROP, and both wear the same block-type
 * class, so a rule naming `disc` would put bullets on ordered lists. `revert`
 * rolls back to the user-agent value for whichever element it lands on, which
 * is discs for one and numerals for the other, and it stays correct if the prop
 * grows a third kind.
 *
 * The inline padding is the other half. A marker is drawn OUTSIDE the content
 * box by default, so restoring it to a list whose padding a reset has zeroed
 * paints it beyond the element's own edge — clipped, or overlapping whatever
 * sits alongside. Browsers pair their markers with roughly `40px`; `2.5ch`
 * tracks the text instead, so a long numeral in a wide font still has room.
 */
const LIST_BASE_STYLES = {
  base: {
    base: {
      listStyleType: "revert",
      padding: { inlineStart: "2.5ch" },
    },
  },
} as const;

export const list = defineBlock<ListProps, PageContext>({
  name: "core/list",
  version: 1,
  description:
    "An ordered or unordered list of items, rendered as real list elements so its length and positions are announced.",
  // Palette metadata. The category is imported rather than spelled here so
  // nineteen blocks cannot drift into nineteen headings; keywords are what
  // let a search for a word the description never uses still find this.
  editor: {
    label: "List",
    icon: "list",
    category: CONTENT,
    keywords: ["bullets", "ordered", "unordered", "items"],
  },
  baseStyles: LIST_BASE_STYLES,
  props: {
    kind: { type: "select", options: [...LIST_KINDS] },
    items: { type: "array", of: "text" },
    start: { type: "number", min: 1 },
  },
  defaultProps: { kind: "unordered", items: [] },
  example: { props: { kind: "unordered", items: ["First", "Second"] } },
  supports: {
    typography: true,
    color: true,
    spacing: true,
    dimensions: true,
    border: true,
    effects: true,
    position: true,
  },
  render: renderList,
});
