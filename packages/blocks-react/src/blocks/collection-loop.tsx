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
  type ListNamedQuery,
  type ListRelation,
} from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";

import type { BlockRenderArgs, ListPageContext, PageContext } from "../context";
import { LIST_ACTION_ATTRIBUTE } from "../editor-markers";

import { CONTENT } from "./categories";
import { CONTAINER_CHILD_GAP } from "./container";
import { ListPages } from "./list-pages";
import {
  listPagesOf,
  listPageWindow,
  namedListBase,
  readList,
  wholeCount,
  type ListOutcome,
} from "./list-read";
import { readNamedList } from "./named-read";

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
  /**
   * Split into pages of `limit` entries, each at its own address
   * (`/news/page/2`), with links between them. One list on a page may be.
   */
  paginate?: boolean;
  /**
   * A custom source: a named query a developer registered, and a literal for
   * each of its inputs. The list's whole source, so `collection`,
   * `relation`, `filters` and `sort` are absent beside it.
   *
   * @experimental
   */
  namedQuery?: ListNamedQuery;
}

/**
 * The key for one iteration.
 *
 * The row's own key when it has one, of either type a database hands back,
 * and its position otherwise: an entry's id, or the field a named query
 * declares its rows keyed by. Falling back for a numeric key would give every
 * row in a numerically-keyed collection a positional key, which is exactly
 * the case where reordering silently reuses the wrong DOM node.
 */
export function listItemKey(
  item: Readonly<Record<string, unknown>>,
  index: number,
  keyField = "id"
): string | number {
  const key = item[keyField];
  return typeof key === "string" || typeof key === "number" ? key : index;
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

/**
 * The context a list's template is drawn with when the list reads nothing:
 * with NO item, not the item of a list around this one. What this list's
 * item decides inside it would otherwise be judged, and shown, by an
 * unrelated entry; with none, it fails closed instead.
 */
function withoutItem(ctx: PageContext): PageContext {
  const {
    item: _outerItem,
    itemSource: _outerSource,
    itemQuery: _outerQuery,
    ...rest
  } = ctx;
  return rest;
}

/**
 * The entries a list draws, and the context each is drawn with: the list's
 * read for a collection or a relation, or its named query's run.
 */
interface ListRead {
  readonly outcome: ListOutcome;
  readonly itemContext: (item: Record<string, unknown>) => PageContext;
  /** The field each row is keyed by; an entry's id when absent. */
  readonly rowKey?: string;
  /** How many entries match before the window, where the read says. */
  readonly matching?: number;
}

/**
 * The page this render draws of the list `nodeId`, when the route pages it:
 * the one list it names, so no other list on the page is paged by its
 * address.
 */
function pagingOf(
  props: CollectionLoopProps,
  ctx: PageContext,
  nodeId: string
): ListPageContext | undefined {
  return props.paginate === true && ctx.listPage?.nodeId === nodeId
    ? ctx.listPage
    : undefined;
}

/**
 * A list whose source is a named query, read; `undefined` for any other
 * list. Claims nothing up front: each read the query makes claims its own.
 * Where the route pages the list, its run is asked for the page drawn, and
 * must say how many rows match, which its links are counted from.
 */
async function readNamedSource(
  props: CollectionLoopProps,
  ctx: PageContext,
  nodeId: string,
  paging: ListPageContext | undefined
): Promise<ListRead | "template" | undefined> {
  const base = namedListBase(props);
  if (base === undefined) return undefined;
  if (ctx.namedQueries === undefined) return "template";
  const itemOf =
    (rowsCollection: string | undefined, query: string) =>
    (item: Record<string, unknown>): PageContext => ({
      ...ctx,
      item,
      itemQuery: query,
      // A collection's entries bind as that collection's; rows of a declared
      // schema bind as the query's, never as the outer list's collection.
      itemSource: rowsCollection,
    });
  if ("blocking" in base) {
    return {
      outcome: {
        items: [],
        failed: true,
        diagnostic: {
          kind: "query-failed",
          message: `This list couldn't load its entries, so visitors see its empty state. ${base.blocking}`,
        },
      },
      itemContext: item => ({ ...ctx, item }),
    };
  }
  const outcome = await readNamedList(
    base.named,
    listPageWindow(
      { limit: base.limit, offset: base.offset },
      paging?.page ?? 1
    ),
    { ...ctx, namedQueries: ctx.namedQueries },
    nodeId,
    { counted: paging !== undefined }
  );
  return {
    outcome,
    itemContext: itemOf(outcome.rowsCollection, base.named.name),
    ...(outcome.rowKey === undefined ? {} : { rowKey: outcome.rowKey }),
    ...(outcome.total === undefined ? {} : { matching: outcome.total }),
  };
}

/**
 * The links between a list's pages, under its entries, when the route pages
 * it and its read succeeded: counted by the route where it served this page
 * by a count, and otherwise from the read's own count of matching entries.
 */
function pageLinks(
  paging: ListPageContext | undefined,
  read: Pick<ListRead, "outcome" | "matching">,
  props: CollectionLoopProps,
  partClass: BlockRenderArgs<CollectionLoopProps>["partClass"]
): ReactElement | null {
  if (paging === undefined || read.outcome.failed) return null;
  return (
    <ListPages
      page={paging.page}
      pages={
        // The route's own count where it served this page by one, so the
        // links never depend on a total this read may not report.
        paging.pages ??
        (read.matching === undefined ? 1 : listPagesOf(props, read.matching))
      }
      href={paging.href}
      parts={{
        nav: partClass("pages"),
        link: partClass("pageLink"),
        current: partClass("currentPage"),
        gap: partClass("pageGap"),
      }}
    />
  );
}

export async function renderCollectionLoop({
  props,
  node,
  renderSlot,
  spacingMode,
  className,
  partClass,
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
  // The page this render draws, when the route pages this list.
  const paging = pagingOf(props, ctx, node.id);
  // A custom source runs the developer's named query, as the page builder
  // registered it, with a reader limited to what it declares.
  const named = await readNamedSource(props, ctx, node.id, paging);
  if (named === "template") {
    // No host runs named queries here, as no data source answers a
    // collection: the template, once, so an author still sees it, with no
    // item, as an unconfigured list draws it.
    return (
      <div className={className}>
        {renderSlot("children", withoutItem(ctx))}
      </div>
    );
  }
  if (named !== undefined) {
    return drawList(
      named,
      { className, renderSlot, spacingMode, ctx },
      pageLinks(paging, named, props, partClass)
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
    // still sees what they are building.
    return (
      <div className={className}>
        {renderSlot("children", withoutItem(ctx))}
      </div>
    );
  }
  // A loop inside a loop runs once per entry of the outer one, so depth in a
  // document becomes multiplication in queries. Claiming from a shared
  // allowance before reading is what keeps a page bounded; without one the
  // renderer is not counting, which is the editor drawing a single block.
  // The list a route pages had its first read claimed for it before any
  // block was drawn, so it does not claim again.
  if (paging?.claimed !== true && ctx.queries?.take() === false) {
    return <div className={className} />;
  }
  // The count of matching entries, as the read reports it, for the links.
  let matching: number | undefined;
  // Never throws: a page that cannot reach its data draws the list's empty
  // state rather than failing, and an author is told why.
  const outcome = await readList(
    props,
    collection,
    ctx,
    {
      find: async query => {
        const result = await data.find(query);
        // A provider's own answer, held to what a count can be, as the
        // route's count holds it: anything else draws no links, rather than
        // links to `/page/NaN` the route would never serve.
        matching = wholeCount(result.total);
        return Array.isArray(result.items) ? [...result.items] : [];
      },
      claim: () => ctx.queries?.take() !== false,
    },
    paging?.page
  );
  // The links between pages, under the entries, when the route pages this
  // list and its read said how many entries it matches.
  const pages = pageLinks(
    paging,
    { outcome, ...(matching === undefined ? {} : { matching }) },
    props,
    partClass
  );
  return drawList(
    {
      outcome,
      // An ordinary entry: the item is no named query's row, whatever the
      // list around this one shows.
      itemContext: item => ({
        ...ctx,
        item,
        itemSource: collection,
        itemQuery: undefined,
      }),
    },
    { className, renderSlot, spacingMode, ctx },
    pages
  );
}

/**
 * A list drawn from its read: each entry with the template, or the empty
 * state, then the links between its pages when it has them.
 */
function drawList(
  read: ListRead,
  args: Pick<
    BlockRenderArgs<CollectionLoopProps>,
    "className" | "renderSlot" | "spacingMode" | "ctx"
  >,
  pages: ReactElement | null = null
): ReactElement {
  const { outcome, itemContext } = read;
  const { className, renderSlot, spacingMode, ctx } = args;
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
            key={listItemKey(item, index, read.rowKey)}
            // Under the classic model no gap is written, so an entry wears
            // nothing: its blocks space themselves with their own margins.
            {...(spacingMode === "classic" ? {} : { className: ENTRY_CLASS })}
          >
            {/* Drawn again per entry, with this entry on the context, so
                anything inside the template reads its own values rather than
                the first entry's. Its source goes with it, so an item
                binding is checked against that source's fields. */}
            {renderSlot("children", itemContext(item))}
          </div>
        ));
  // The note, when an author is looking, goes above what visitors see.
  return (
    <div className={className} {...marks}>
      {note}
      {content}
      {pages}
    </div>
  );
}

/** A page link's own colours, in both themes, from the site's tokens. */
const PAGE_LINK_BORDER = {
  width: {
    blockStart: "1px",
    blockEnd: "1px",
    inlineStart: "1px",
    inlineEnd: "1px",
  },
  style: "solid",
} as const;

/**
 * The links between a list's pages, named so a site styles them as it
 * styles the list. They must read as controls in a host whose reset strips
 * a link of everything but its text, so each states a box, a border a person
 * can see (`color.border-strong`, the one that clears 3:1 against the page)
 * and a size a finger can hit; the current page is filled with the primary
 * colour. Colours are tokens, so both themes hold.
 */
const COLLECTION_LOOP_PARTS = {
  pages: {
    baseStyles: {
      base: {
        base: {
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "0.5rem",
          margin: { blockStart: "2rem" },
        },
      },
    },
  },
  pageLink: {
    baseStyles: {
      base: {
        base: {
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          boxSizing: "border-box",
          minWidth: "2.5rem",
          minHeight: "2.5rem",
          padding: { inlineStart: "0.75rem", inlineEnd: "0.75rem" },
          borderRadius: "6px",
          border: {
            ...PAGE_LINK_BORDER,
            color: { $token: "color.border-strong" },
          },
          backgroundColor: { $token: "color.background" },
          color: { $token: "color.text" },
          textDecoration: "none",
        },
      },
      hover: {
        base: { backgroundColor: { $token: "color.surface" } },
      },
    },
  },
  currentPage: {
    baseStyles: {
      base: {
        base: {
          border: { ...PAGE_LINK_BORDER, color: { $token: "color.primary" } },
          backgroundColor: { $token: "color.primary" },
          color: { $token: "color.background" },
        },
      },
      // Kept filled under the pointer, which the plain link's hover would
      // otherwise repaint.
      hover: {
        base: { backgroundColor: { $token: "color.primary" } },
      },
    },
  },
  pageGap: {
    baseStyles: {
      base: {
        base: {
          padding: { inlineStart: "0.25rem", inlineEnd: "0.25rem" },
          color: { $token: "color.text" },
        },
      },
    },
  },
} as const;

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
      paginate: { label: "Split into pages", type: "checkbox" },
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
    parts: COLLECTION_LOOP_PARTS,
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
