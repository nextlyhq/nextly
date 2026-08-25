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
 * The template is drawn once per entry rather than drawn once and copied, with
 * the entry named on the context each time. That is the whole reason a slot is
 * something a block DRAWS rather than something it receives finished: handed
 * finished output, a repeater could only stamp the same picture, and nothing
 * inside it could show its own entry's fields.
 *
 * @module blocks/library/collection-loop
 */
import { defineBlock } from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";

import type { BlockRenderArgs, PageContext } from "../context";

import { CONTENT } from "./categories";

export interface CollectionLoopProps {
  /** The collection queried. */
  collection?: string;
  /** How many entries at most. */
  limit?: number;
  /** Sort expression handed to the data layer unchanged. */
  sort?: string;
}

/**
 * The key for one iteration.
 *
 * An entry's own id when it has one, of either type a database hands back, and
 * its position otherwise. Falling back for a numeric id would give every row in
 * a numerically-keyed collection a positional key, which is exactly the case
 * where reordering silently reuses the wrong DOM node.
 */
function keyFor(item: Record<string, unknown>, index: number): string | number {
  const id = item.id;
  return typeof id === "string" || typeof id === "number" ? id : index;
}

/** The prop schema's bounds, applied to what was actually stored. */
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 10;

/**
 * The number of entries to ask for.
 *
 * The schema's bounds describe what an editor offers, not what a document
 * holds: props are validated as an object and nothing more, so a stored or
 * migrated node can carry a limit of zero, of minus one, or of a million. The
 * value goes straight to a host-supplied data source, which may honour a huge
 * one or reject a malformed one and take the block with it.
 */
function safeLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.floor(limit)));
}

export async function renderCollectionLoop({
  props,
  renderSlot,
  className,
  ctx,
}: BlockRenderArgs<CollectionLoopProps>): Promise<ReactElement> {
  // A cleared text field persists as an empty string, which is a collection
  // nobody named rather than a collection called "". Querying for it fails, the
  // failure is swallowed below, and the block renders empty instead of showing
  // its template the way an unconfigured loop is supposed to.
  const collection =
    typeof props.collection === "string" && props.collection.trim() !== ""
      ? props.collection.trim()
      : undefined;
  const { data } = ctx;
  if (collection === undefined || data === undefined) {
    // Nothing to query against, so the block renders its template once rather
    // than vanishing: an author placing a loop before choosing a collection
    // still sees what they are building.
    return <div className={className}>{renderSlot("children")}</div>;
  }
  let items: Record<string, unknown>[] = [];
  // A loop inside a loop runs once per entry of the outer one, so depth in a
  // document becomes multiplication in queries. Claiming from a shared
  // allowance before reading is what keeps a page bounded; without one the
  // renderer is not counting, which is the editor drawing a single block.
  if (ctx.queries?.take() === false) {
    return <div className={className} />;
  }
  try {
    const result = await data.find({
      collection,
      limit: safeLimit(props.limit),
      ...(typeof props.sort === "string" && props.sort !== ""
        ? { sort: props.sort }
        : {}),
      // The locale the page is being rendered in. Without it the provider reads
      // the default one, so a French page embeds English rows — the surrounding
      // blocks translate and the looped content silently does not. Taken from
      // the context rather than from a prop: which locale a page is in is the
      // route's decision, not a per-block one an editor could contradict.
      ...(ctx.locale === undefined ? {} : { locale: ctx.locale }),
    });
    items = Array.isArray(result.items) ? result.items : [];
  } catch {
    // A page that cannot reach its data renders empty rather than failing.
    items = [];
  }
  return (
    <div className={className}>
      {items.map((item, index) => (
        <div key={keyFor(item, index)}>
          {/* Drawn again per entry, with this entry on the context, so anything
              inside the template reads its own values rather than the first
              entry's. */}
          {renderSlot("children", { ...ctx, item })}
        </div>
      ))}
    </div>
  );
}

// Defined against the ENGINE's `defineBlock`, not the plugin SDK's: the engine
// declares the contract and the SDK re-exports it for third parties. The
// context is named rather than augmented, so a block compiled against the
// published types is typed the same as one compiled here. See `./index.ts`.
export const collectionLoop = defineBlock<CollectionLoopProps, PageContext>({
  name: "core/collection-loop",
  version: 1,
  description:
    "Repeats its children once per entry in a collection. Renders its template once while no collection is chosen, and renders empty when the data source cannot be reached.",
  // Palette metadata. The category is imported rather than spelled here so
  // nineteen blocks cannot drift into nineteen headings; keywords are what
  // let a search for a word the description never uses still find this.
  editor: {
    label: "Collection loop",
    icon: "loop",
    category: CONTENT,
    keywords: ["repeat", "query", "entries", "dynamic"],
  },
  props: {
    collection: { type: "text" },
    limit: { type: "number", min: 1, max: 100 },
    sort: { type: "text" },
  },
  defaultProps: { limit: 10 },
  example: { props: { collection: "posts", limit: 3 } },
  slots: {
    // The template repeated per entry, structurally editable.
    //
    // It starts empty, and `contentOnly` forbids exactly the edits that would
    // fill it: an author could never insert the blocks that make up the
    // template, so the loop could never show an entry. Locking a template is
    // worth having once there is a way to lock a FINISHED one; locking an empty
    // one only prevents it from being written.
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
  // The children are drawn once per entry, so a query returning nothing draws
  // them ZERO times. A reader of the stored document sees the template either
  // way and cannot tell which happened without running the query, so it is told
  // here instead — otherwise an empty loop's heading speaks for the page.
  conditionalSlots: ["children"],
  render: renderCollectionLoop,
});
