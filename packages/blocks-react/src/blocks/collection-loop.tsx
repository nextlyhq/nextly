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
 * Failure is contained rather than fatal: a query that throws draws the list's
 * empty state and the page survives, and an author looking (the editor, a
 * preview) is told what failed. That is the "strict at publish, forgiving at
 * render" half of the migration policy applied to data — a page that cannot
 * reach its database should degrade, not disappear. How the stored query
 * becomes reads is `list-read`'s.
 *
 * The template is drawn once per entry rather than drawn once and copied, with
 * the entry named on the context each time. That is the whole reason a slot is
 * something a block DRAWS rather than something it receives finished: handed
 * finished output, a repeater could only stamp the same picture, and nothing
 * inside it could show its own entry's fields.
 *
 * @module blocks/library/collection-loop
 */
import {
  type BlockDefinition,
  blockTypeClassName,
  CHILD_GAP_CLASS,
  COLLECTION_LIST_TYPE,
  defineBlock,
  type ListFilter,
  type ListRelation,
} from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";

import type { BlockRenderArgs, PageContext } from "../context";
import { LIST_ACTION_ATTRIBUTE } from "../editor-markers";

import { CONTENT } from "./categories";
import { CONTAINER_CHILD_GAP } from "./container";
import { readList, type ListOutcome } from "./list-read";

export interface CollectionLoopProps {
  /** The collection queried, or the collection a related source's entries are in. */
  collection?: string;
  /** How many entries at most: 1 to 100. */
  limit?: number;
  /**
   * Sort keys, comma-separated, `-field` descending. The id breaks ties, and
   * empty values come last either way. A key the reader refuses lists in id
   * order instead, and an author is told.
   */
  sort?: string;
  /** Filter rows, all of which an entry must meet. */
  filters?: ListFilter[];
  /** How many matching entries to skip, from 0. */
  offset?: number;
  /** The to-many relation of the page's entry or the outer item to list. */
  relation?: ListRelation;
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

/**
 * This block's registered name, used for the definition and for the class each
 * entry's wrapper wears. The engine's, so the validator and the renderer name
 * one block.
 */
const COLLECTION_LOOP_BLOCK = COLLECTION_LIST_TYPE;

/**
 * The classes an entry's wrapper wears: the block-type class and the gap
 * marker, and only those.
 *
 * The loop spaces its children by its `childGap`, written as a rule on the
 * block-type class and the gap marker together. On the loop itself that
 * separates one entry from the next; worn by each entry's wrapper, the same
 * rule spaces the blocks inside an entry exactly as it spaces the template
 * when no collection is configured. The node class stays on the loop alone,
 * so an author's styling of the loop (a flex row of entries, say) applies to
 * the loop and not to every entry.
 */
const ENTRY_CLASS = `${blockTypeClassName(COLLECTION_LOOP_BLOCK)} ${CHILD_GAP_CLASS}`;

/**
 * The note an author sees about a list's read, and a visitor never: drawn
 * only when the context says an author is looking. Unstyled here; the
 * editor's chrome styles it by its data attribute.
 */
function diagnosticNote(
  outcome: ListOutcome,
  ctx: PageContext
): ReactElement | null {
  if (ctx.diagnostics !== true || outcome.diagnostic === undefined) return null;
  // One action, on the editor's canvas only: a sort that fell back is fixed
  // by choosing another field, which the canvas takes the author to. A failed
  // read has no one fix, so its note stays words alone.
  const offersChoice =
    ctx.listNoteActions === true && outcome.diagnostic.kind === "sort-fallback";
  return (
    <div role="status" data-nx-list-diagnostic={outcome.diagnostic.kind}>
      <span>{outcome.diagnostic.message} Only you see this message.</span>
      {offersChoice ? (
        <button
          type="button"
          {...{ [LIST_ACTION_ATTRIBUTE]: "choose-sort-field" }}
        >
          Choose a field
        </button>
      ) : null}
    </div>
  );
}

/**
 * Why a list an author is looking at draws its empty state: they chose to
 * see it, no entry matched, or the read failed. Written on the list's root
 * for the editor's chrome, which tags the list with it, and only while an
 * author is looking.
 */
type EmptyBecause = "chosen" | "none" | "failed";

/** The marks on a list's root saying it draws its empty state, and why. */
function emptyMarks(
  ctx: PageContext,
  because: EmptyBecause | undefined
): Record<string, string> {
  return ctx.diagnostics === true && because !== undefined
    ? { "data-nx-list-shows": "empty", "data-nx-list-empty-because": because }
    : {};
}

export async function renderCollectionLoop({
  props,
  node,
  renderSlot,
  spacingMode,
  className,
  ctx,
}: BlockRenderArgs<CollectionLoopProps>): Promise<ReactElement> {
  // An author asked to design what visitors see when nothing matches: the
  // empty state alone, with nothing read. Only where an author is looking.
  if (
    ctx.diagnostics === true &&
    ctx.listsShowingEmpty?.has(node.id) === true
  ) {
    return (
      <div className={className} {...emptyMarks(ctx, "chosen")}>
        {renderSlot("empty")}
      </div>
    );
  }
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
    // still sees what they are building. Drawn with NO item, not the item of
    // a list around this one: what this list's item decides inside it would
    // otherwise be judged by an unrelated entry, and fails closed instead.
    const { item: _outerItem, itemSource: _outerSource, ...withoutItem } = ctx;
    return (
      <div className={className}>{renderSlot("children", withoutItem)}</div>
    );
  }
  // A loop inside a loop runs once per entry of the outer one, so depth in a
  // document becomes multiplication in queries. Claiming from a shared
  // allowance before reading is what keeps a page bounded; without one the
  // renderer is not counting, which is the editor drawing a single block.
  if (ctx.queries?.take() === false) {
    return <div className={className} />;
  }
  // Never throws: a page that cannot reach its data draws the list's empty
  // state rather than failing, and an author is told why.
  const outcome = await readList(props, collection, ctx, {
    find: async query => {
      const result = await data.find(query);
      return Array.isArray(result.items) ? [...result.items] : [];
    },
    claim: () => ctx.queries?.take() !== false,
  });
  const note = diagnosticNote(outcome, ctx);
  const marks = emptyMarks(
    ctx,
    outcome.items.length > 0 ? undefined : outcome.failed ? "failed" : "none"
  );
  // Nothing matched, or the read failed: the designable empty state, as a
  // visitor sees it. Otherwise each entry, drawn with the template.
  const content =
    outcome.items.length === 0
      ? renderSlot("empty")
      : outcome.items.map((item, index) => (
          <div
            key={keyFor(item, index)}
            // Under the classic model no gap is written, so an entry wears
            // nothing: its blocks space themselves with their own margins.
            {...(spacingMode === "classic" ? {} : { className: ENTRY_CLASS })}
          >
            {/* Drawn again per entry, with this entry on the context, so
                anything inside the template reads its own values rather than
                the first entry's. The collection goes with it, so an item
                binding is checked against that collection's fields. */}
            {renderSlot("children", { ...ctx, item, itemSource: collection })}
          </div>
        ));
  // The note, when an author is looking, goes above what visitors see.
  return note === null ? (
    <div className={className} {...marks}>
      {content}
    </div>
  ) : (
    <div className={className} {...marks}>
      {note}
      {content}
    </div>
  );
}

// Defined against the ENGINE's `defineBlock`, not the plugin SDK's: the engine
// declares the contract and the SDK re-exports it for third parties. The
// context is named rather than augmented, so a block compiled against the
// published types is typed the same as one compiled here. See `./index.ts`.
export const collectionLoop: BlockDefinition<CollectionLoopProps, PageContext> =
  defineBlock({
    name: COLLECTION_LOOP_BLOCK,
    version: 1,
    // What an author reads, in the Add panel and the block card: one plain
    // line. What the block does, for whoever maintains it: Repeats its children
    // once per entry in a collection. Renders its template once while no
    // collection is chosen, and renders empty when the data source cannot be
    // reached.
    description: "Repeats its contents for each entry in a collection.",
    // Palette metadata. The category is imported rather than spelled here so
    // nineteen blocks cannot drift into nineteen headings; keywords are what
    // let a search for a word the description never uses still find this.
    // Named "Collection list" for authors; the stored type keeps its old
    // name, so pages already saved still name this block, and "loop" stays a
    // keyword so a search for the old name finds it.
    editor: {
      label: "Collection list",
      icon: "loop",
      category: CONTENT,
      keywords: ["repeat", "query", "entries", "dynamic", "loop"],
    },
    props: {
      // Still text, as stored: `display` asks the editor to offer the site's
      // collections, and the sort keys of the collection `collectionProp`
      // names, rather than a field to type a slug or a key into. The editor
      // draws all of a list's query as one group where `collection` sits,
      // asked for by `display: "listFilters"`; the shapes are the engine's
      // `readListQuery`, which every reader shares.
      collection: { label: "Source", type: "text", display: "collection" },
      relation: {
        label: "Related entries",
        type: "object",
        display: "listRelation",
        collectionProp: "collection",
      },
      filters: {
        label: "Filters",
        type: "array",
        display: "listFilters",
        collectionProp: "collection",
      },
      sort: {
        label: "Sort by",
        type: "text",
        display: "sort",
        collectionProp: "collection",
      },
      limit: { label: "Number of items", type: "number", min: 1, max: 100 },
      offset: { label: "Skip the first", type: "number", min: 0 },
    },
    defaultProps: { limit: 10 },
    example: { props: { collection: "posts", limit: 3 } },
    slots: {
      // The template repeated per entry, structurally editable.
      //
      // It declares no starting children, and `contentOnly` would forbid exactly
      // the edits that fill it: an author could never insert the blocks the loop
      // repeats, so the loop could never show an entry. Locking is worth having
      // once there is a way to lock a FINISHED body; locking an empty one only
      // prevents it from being written.
      //
      // Nor could a default supply that body. What one entry should look like is
      // a property of the collection being looped, which this block cannot see
      // from its own declaration.
      children: {},
      // Drawn in place of the entries when none match, or when the read
      // failed, so a visitor sees a designed "nothing here yet" rather than
      // a gap. Left empty, the list shows nothing, as it always did.
      empty: {},
    },
    // Spaces one entry from the next, as any container spaces its blocks.
    childGap: CONTAINER_CHILD_GAP,
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
    //
    // The empty state is the other half: drawn only when no entry is.
    conditionalSlots: ["children", "empty"],
    render: renderCollectionLoop,
  });
