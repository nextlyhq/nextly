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

import { number, oneOf, text } from "./props";

export const LIST_KINDS = ["unordered", "ordered"] as const;

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
  const items = Array.isArray(stored) ? stored.map(item => text(item)) : [];
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
export const list = defineBlock<ListProps, PageContext>({
  name: "core/list",
  version: 1,
  description:
    "An ordered or unordered list of items, rendered as real list elements so its length and positions are announced.",
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
