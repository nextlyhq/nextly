/**
 * `core/collection-loop` — repeat a slot template over queried entries.
 *
 * The dynamic third of the DX gate: an async render, so a block that reads data
 * is an ordinary server component rather than a second rendering mode. This is
 * the whole reason the render contract is one function. Gutenberg's dynamic
 * blocks re-render through a REST round trip per change, a mechanism its own
 * docs now disown as legacy, and Elementor V3 asks for a PHP `render()` plus a
 * duplicate JS template for live preview. Here the canvas and the page run the
 * same function.
 *
 * Failure is contained rather than fatal: a query that throws renders nothing
 * and the page survives. That is the "strict at publish, forgiving at render"
 * half of the migration policy applied to data — a page that cannot reach its
 * database should degrade, not disappear.
 *
 * **What this cannot do yet, and why it is worth knowing.** `slots.children` is
 * already-rendered output, so every iteration below repeats the SAME element.
 * The template is duplicated once per entry, but a child inside it cannot show
 * that entry's fields, because nothing in the render contract lets a block ask
 * for its slot to be rendered again under a different value. A repeater needs
 * exactly that, and no arrangement of the current arguments provides it.
 *
 * That makes this useful for repeating a fixed template a data-driven number of
 * times, and not yet useful for listing content. Closing the gap is a change to
 * what a slot IS, which is why it is recorded rather than worked around here.
 *
 * @module blocks/library/collection-loop
 */
import { defineBlock } from "@nextlyhq/plugin-sdk/blocks";
import type { BlockRenderArgs } from "@nextlyhq/plugin-sdk/blocks";
import type { ReactElement } from "react";

export interface CollectionLoopProps {
  /** The collection queried. */
  collection?: string;
  /** How many entries at most. */
  limit?: number;
  /** Sort expression handed to the data layer unchanged. */
  sort?: string;
}

export async function renderCollectionLoop({
  props,
  renderSlot,
  className,
  ctx,
}: BlockRenderArgs<CollectionLoopProps>): Promise<ReactElement> {
  const { collection } = props;
  const { data } = ctx;
  if (collection === undefined || data === undefined) {
    // Nothing to query against, so the block renders its template once rather
    // than vanishing: an author placing a loop before choosing a collection
    // still sees what they are building.
    return (
      <div className={className}>{renderSlot("children") as ReactElement}</div>
    );
  }
  let items: Record<string, unknown>[] = [];
  try {
    const result = await data.find({
      collection,
      limit: props.limit ?? 10,
      ...(props.sort === undefined ? {} : { sort: props.sort }),
    });
    items = result.items;
  } catch {
    // A page that cannot reach its data renders empty rather than failing.
    items = [];
  }
  return (
    <div className={className}>
      {items.map((item, index) => (
        <div key={typeof item.id === "string" ? item.id : index}>
          {/* Drawn again per entry, with this entry on the context, so anything
              inside the template reads its own values rather than the first
              entry's. */}
          {renderSlot("children", { ...ctx, item }) as ReactElement}
        </div>
      ))}
    </div>
  );
}

export const collectionLoop = defineBlock<CollectionLoopProps>({
  name: "core/collection-loop",
  version: 1,
  description:
    "Repeats its children once per entry in a collection. Renders its template once while no collection is chosen, and renders empty when the data source cannot be reached.",
  props: {
    collection: { type: "text" },
    limit: { type: "number", min: 1, max: 100 },
    sort: { type: "text" },
  },
  defaultProps: { limit: 10 },
  example: { props: { collection: "posts", limit: 3 } },
  slots: {
    // The template repeated per entry. Locked to content-only editing: the
    // shape is the author's, the repetition is the block's, and letting a
    // structural edit happen per iteration is how a repeater becomes
    // unpredictable.
    children: { template: [], lock: "contentOnly" },
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
  render: renderCollectionLoop,
});
