/**
 * What a page reads before it draws, and how it is drawn, in the published
 * route's order: the components it places, its Layout's regions and their
 * components, what its bindings and its conditions read, the terms its lists
 * compare days by, the first read of the list it splits into pages, and the
 * binding pass its lists' items are filled by.
 *
 * Its own module, importing nothing of the CMS, so the published route and
 * the editor's count of a page's reads run the ONE pipeline: each gives the
 * reads it can make (`PageReadSources`) and the stages, their order and what
 * they hand the renderer are the same. A read only the server can make (the
 * Layout a page is drawn inside, its bindings' sources) is the source's to
 * make, never a second implementation's.
 *
 * @module page-read-stages
 * @experimental Settles with the editor's read meter.
 */
import {
  bindingDemand,
  COLLECTION_LIST_TYPE,
  conditionDemand,
  conditionFieldKind,
  DEFAULT_LIMITS,
  isListDay,
  LIST_ENTRY_SLOT,
  paginatedList,
  regionDocument,
  safeTimeZone,
  type BindingFieldShape,
  type BindingRun,
  type BlockDocument,
  type BlockNode,
  type ConditionDemand,
  type DefinitionsById,
  type DocumentLimits,
  type LayoutRegion,
  type PaginatedList,
  type SiteSheetInput,
  type StyleCompileContext,
} from "@nextlyhq/blocks-engine";
import { createElement, type ReactElement } from "react";

import {
  conditionDayStart,
  listWillRead,
  namedListBase,
} from "./blocks/list-read";
import { queryRowFields } from "./blocks/named-read";
import {
  definitionsFor,
  EMPTY_DEFINITIONS,
  type ComponentSource,
} from "./component-source";
import type {
  BindingIssuesHandler,
  BlocksSiteSettings,
  ListBatchReads,
  ListPageContext,
  NamedQueryHost,
  NamedQueryLookup,
  PageBindings,
  PageContext,
  PageIssue,
  QueryBudget,
} from "./context";
import {
  anyListWhere,
  listCollectionsWhere,
  listPropsAsBound,
} from "./list-collections";
import { layoutPartSheets, type PagePart } from "./page-parts";
import { PageRenderer } from "./page-renderer";
import {
  heldConditionsOf,
  holdsBackConditions,
  pageBindingRun,
  prepareDocument,
  regateDocument,
  type PreparedDocument,
} from "./prepare-document";
import type { BlockResolver } from "./resolver";
import { entrySubjectOf, type ConditionGate } from "./visibility";

/** Where the entry a page shows lives, which decides how the public reads it. */
export type EntrySource = "collection" | "single";

/**
 * Where a page is drawn, as its route resolved it: the collection and slug it
 * names in what it logs, its language, the page of its list it draws and the
 * address of each, where the route serves a list's later pages.
 */
export interface PageWhere {
  readonly collection: string;
  readonly slug: string;
  readonly locale?: string | undefined;
  readonly page?: number | undefined;
  readonly listPagePath?: ((page: number) => string) | undefined;
  readonly listPages?: number | undefined;
}

/** What the route draws a page under, beyond what it reads. */
export interface PageReadTerms {
  /**
   * The blocks the renderer is handed, the same object, so it reuses the
   * preparation made here.
   */
  readonly resolver: BlockResolver;
  readonly limits?: DocumentLimits | undefined;
  readonly styleContext?: StyleCompileContext | undefined;
  /** The route's own zone, which a page's dates use before the site's. */
  readonly timeZone?: string | undefined;
  /** The site's named queries, a custom source's items read by. */
  readonly namedQueries?: NamedQueryLookup | undefined;
  /** The collection the route reads media from. */
  readonly mediaCollection?: string | undefined;
}

/** What a page's bindings are asked to read. */
export interface BindingsAsk {
  /** The documents as the page reads them, every conditioned block kept. */
  readonly documents: readonly BlockDocument[];
  /** The entry fields its conditions check, where they have an entry. */
  readonly conditions?: ConditionDemand;
}

/** A page's Layout regions, and the definitions they reach. */
export interface LayoutRead {
  readonly regions: readonly LayoutRegion[];
  readonly regionDefinitions: DefinitionsById;
}

/**
 * The reads a page's stages make, each claimed from the page's one budget
 * by the source: the published route's through the CMS, the editor's count
 * through what the editor read.
 */
export interface PageReadSources {
  /** The components a document places, one ask per nesting level. */
  readonly components: ComponentSource;
  /** The page's Layout regions and their components, after its own. */
  layout(): Promise<LayoutRead>;
  /** What the page's bindings and its conditions read. */
  bindings(ask: BindingsAsk): Promise<PageBindings | undefined>;
  /** One collection's field shapes, as the public reads them. */
  fieldShapes(
    collection: string
  ): Promise<readonly BindingFieldShape[] | undefined>;
  /** The site settings, read once for the page. */
  site(): Promise<BlocksSiteSettings | undefined>;
}

/**
 * What decides whether a route reads a list's images in batches.
 *
 * @experimental
 */
export interface RouteMedia {
  /** The site resolves media itself (`resolveMedia`), one id at a time. */
  readonly ownResolver?: boolean;
  /** The collection the route reads media from, by `id in`. */
  readonly mediaCollection?: string | undefined;
  /**
   * Whether the media library offers a read of many ids (`findByIDs`), as
   * Nextly's does; a reader without it reads each image by its own id.
   */
  readonly libraryReadsMany?: boolean;
}

/**
 * Whether a route reads a list's images in batches: not where the site
 * resolves media itself; by `id in` where it names a media collection;
 * through the media library's `findByIDs` where it has one. The route and
 * the editor's read count both ask this one question.
 *
 * @experimental
 */
export function readsMediaInBatches(media: RouteMedia): boolean {
  if (media.ownResolver === true) return false;
  return (
    media.mediaCollection !== undefined || media.libraryReadsMany !== false
  );
}

/** No Layout: what a page drawn alone reads for one. */
const NO_REGIONS: LayoutRead = {
  regions: [],
  regionDefinitions: EMPTY_DEFINITIONS,
};

/**
 * The caps a page's documents are held to, resolved the way the pipeline
 * resolves them.
 *
 * One answer, because two would be a disagreement about which nodes exist: the
 * fetch decides what to load and the renderer decides what to draw, and a page
 * whose instances sit past one cap but inside the other loses exactly the
 * blocks between them.
 */
export function effectiveLimits(
  terms: Pick<PageReadTerms, "limits" | "styleContext">
): DocumentLimits {
  return terms.limits ?? terms.styleContext?.limits ?? DEFAULT_LIMITS;
}

/** One document a page draws, and the preparation its reads and render share. */
export interface DrawnDocument {
  readonly document: BlockDocument;
  readonly prepared: PreparedDocument | null;
}

/** One region of the page's Layout, as drawn. */
export interface DrawnRegion extends DrawnDocument {
  readonly region: LayoutRegion;
}

/** Prepare one document once, under the arguments the renderer is given. */
function drawn(
  terms: PageReadTerms,
  document: BlockDocument,
  definitions: DefinitionsById
): DrawnDocument {
  return {
    document,
    prepared: prepareDocument(document, {
      resolver: terms.resolver,
      ...(terms.limits === undefined ? {} : { limits: terms.limits }),
      ...(terms.styleContext === undefined
        ? {}
        : { styleContext: terms.styleContext }),
      ...(definitions.size === 0 ? {} : { definitions }),
    }),
  };
}

/** What a page render, and its metadata, work from. */
export interface PageInputs {
  /**
   * The page's document as read and drawn: the one asked for, or, where the
   * caller fits it to the components it places (`fit`), that.
   */
  readonly document: BlockDocument;
  readonly definitions: DefinitionsById;
  readonly page: DrawnDocument;
  readonly regions: readonly DrawnRegion[];
  readonly regionDefinitions: DefinitionsById;
  readonly bindings: PageBindings | undefined;
  /**
   * The documents as the page presents them: composed, migrated and gated,
   * the page's and each region's. What the page's reads are asked of, so a
   * list inside a component is seen where the stored page holds only the
   * component's instance.
   */
  readonly presented: readonly BlockDocument[];
}

/**
 * Everything a page reads before it renders, in ONE order shared by the
 * render and the metadata: the components the page inlines, its Layout's
 * regions and their components, then what its bindings read. Both spend the
 * budget alike, so under a tight one the page and its metadata cannot
 * disagree about a bound value. Each document is prepared once, and that
 * preparation is what the reads are taken from and what the renderer reuses.
 *
 * Metadata draws no region, so it reads the Layout only when the page holds
 * a binding, whose read must come at the same point of the budget as the
 * render's; a page with none reads nothing more for its metadata.
 */
export async function readPageInputs(args: {
  terms: PageReadTerms;
  sources: PageReadSources;
  document: BlockDocument;
  entrySource: EntrySource;
  /** How the page reports the conditions it could not check. */
  onIssues: BindingIssuesHandler;
  /** For metadata, which reads the Layout only when the page binds anything. */
  regionsOnlyWhenBound?: boolean;
  /**
   * The document fitted to the definitions read for it, where what it holds
   * depends on them: a template's entry content is cut to the room its
   * components leave once expanded. It may only drop what `document` holds,
   * so the definitions read for `document` are all it needs.
   */
  fit?: (definitions: DefinitionsById) => BlockDocument;
}): Promise<PageInputs> {
  const { terms, sources } = args;
  // Read BEFORE the element is created, because the renderer's pipeline is
  // synchronous: composition is a pass of it, and a pass cannot await. The
  // route is the layer that can, which is why the fetch lives here and not
  // in the renderer.
  const definitions = await definitionsFor(
    args.document,
    sources.components,
    // The SAME caps the pipeline will read this document under, resolved
    // once. `prepareDocumentReadStages` falls back to the style context's
    // when no limits are given directly, so passing the default here made
    // a route that raised `maxNodes` through `styleContext` fetch for the
    // first 5,000 nodes while the renderer kept — and tried to draw —
    // every instance after them.
    effectiveLimits(terms)
  );
  const document = args.fit?.(definitions) ?? args.document;
  const page = drawn(terms, document, definitions);
  // Whether the page's conditions have an entry to judge. A Single's page has
  // none, as the editor and the save say, so its entry-scoped conditions fail
  // closed with nothing read, and its conditioned blocks are never kept for
  // the reads: neither their fields nor what they bind is asked for. The ONE
  // place this is decided; the reads, the skip and the decision follow it.
  const conditionsReadEntry = args.entrySource === "collection";
  // Whether the page reads anything is asked of it with every conditioned
  // block kept, as its reads are taken below: a conditioned block's bindings
  // and its conditions' entry read both spend the budget the render spends,
  // so metadata must read the Layout before them just as the render does.
  // Only metadata asks, and the kept page it prepares is reused for the reads.
  const keptPage =
    conditionsReadEntry &&
    args.regionsOnlyWhenBound === true &&
    holdsBackConditions(page.prepared)
      ? keptForReading(page)
      : undefined;
  const pageReading = keptPage ?? page;
  const skipRegions =
    args.regionsOnlyWhenBound === true &&
    (pageReading.prepared === null ||
      !readsAnything(pageReading.prepared.presented));
  const { regions, regionDefinitions } = skipRegions
    ? NO_REGIONS
    : await sources.layout();
  const drawnRegions = regions.map(region => ({
    region,
    ...drawn(terms, regionDocument([region]), regionDefinitions),
  }));
  const parts: DrawnDocument[] = [page, ...drawnRegions];
  // A page holding conditioned blocks is read with all of them kept: a block
  // that may show asks for what it binds, and its conditions name the entry
  // fields they check. Read once, then decided against what was read.
  const conditioned =
    conditionsReadEntry &&
    parts.some(part => holdsBackConditions(part.prepared));
  // The page kept for metadata's question above is the same reading: not
  // prepared a second time.
  const reading = conditioned
    ? parts.map((part, index) =>
        index === 0 && keptPage !== undefined ? keptPage : keptForReading(part)
      )
    : parts;
  const readingDocs = presentedOf(reading);
  const read = await sources.bindings({
    documents: readingDocs,
    ...(conditioned
      ? { conditions: conditionDemand(readingDocs.flatMap(doc => doc.nodes)) }
      : {}),
  });
  // The collection the route reads media from, so a bound image is filled
  // only from an upload field pointing there.
  const bindings = withMediaCollection(read, terms.mediaCollection);
  const decided = conditioned
    ? decideConditions(parts, bindings, args.onIssues)
    : parts;
  const [decidedPage, ...decidedRegions] = decided;
  return {
    document,
    definitions,
    page: decidedPage ?? page,
    regions: drawnRegions.map((region, index) => ({
      ...region,
      prepared: decidedRegions[index]?.prepared ?? region.prepared,
    })),
    regionDefinitions,
    bindings,
    presented: presentedOf(decided),
  };
}

/**
 * Whether a presented tree reads anything at the route: a binding, or an
 * entry field a condition checks. A list's item conditions read nothing more
 * than the list does.
 */
function readsAnything(presented: BlockDocument): boolean {
  return (
    bindingDemand([presented]).any ||
    conditionDemand(presented.nodes).entryFields.size > 0
  );
}

/** The trees a set of drawn documents present, the unreadable left out. */
function presentedOf(parts: readonly DrawnDocument[]): BlockDocument[] {
  return parts.flatMap(part =>
    part.prepared === null ? [] : [part.prepared.presented]
  );
}

/** A drawn document with every conditioned block kept, for a route's reads. */
function keptForReading(part: DrawnDocument): DrawnDocument {
  const kept =
    part.prepared === null
      ? null
      : regateDocument(part.prepared, "keep-all")?.prepared;
  return kept === undefined || kept === null
    ? part
    : { ...part, prepared: kept };
}

/**
 * Each drawn document gated by its blocks' conditions against the entry the
 * page shows, as the public reads it: the entry's own published values, and
 * only the fields the public may read. A page whose entry the public may not
 * see, or that has none, fails every entry condition closed. What could not
 * be checked is reported once, through the route's own log.
 */
function decideConditions(
  parts: readonly DrawnDocument[],
  bindings: PageBindings | undefined,
  report: BindingIssuesHandler
): DrawnDocument[] {
  const gate: ConditionGate = {
    ...entrySubjectOf(bindings),
    dayStart: conditionDayStart(bindings?.timeZone),
  };
  const issues: PageIssue[] = [];
  const decided = parts.map(part => {
    const regated =
      part.prepared === null ? null : regateDocument(part.prepared, gate);
    if (regated === null) return part;
    issues.push(...regated.issues);
    return { ...part, prepared: regated.prepared };
  });
  if (issues.length > 0) report(issues);
  return decided;
}

/** A page's bindings, told which collection the route reads media from. */
function withMediaCollection(
  bindings: PageBindings | undefined,
  mediaCollection: string | undefined
): PageBindings | undefined {
  return bindings === undefined || mediaCollection === undefined
    ? bindings
    : { ...bindings, mediaCollection };
}

/**
 * The collections whose lists need their fields' shapes while they draw: a
 * list filtering by a day, which compares in the site's zone or as a calendar
 * day by the field's shape, and a list whose entries hold a block its item's
 * fields decide the visibility of.
 */
function listsComparingDays(
  documents: readonly BlockDocument[],
  run: BindingRun | undefined,
  namedQueries: NamedQueryLookup | undefined
): Set<string> {
  return listCollectionsWhere(
    documents,
    (query, list) =>
      query.filters.some(row => isListDay(row.value)) ||
      conditionDemand(list.slots?.[LIST_ENTRY_SLOT] ?? []).any,
    run,
    namedQueries
  );
}

/**
 * Whether any list on the page compares days, and so needs the site's zone:
 * one filtering by a day, or one whose item conditions order a field its
 * collection holds as a date. A list whose item conditions match text, a
 * yes-or-no or a number needs field shapes but no zone, and must not spend
 * the page's query budget reading one. A field whose shape is unknown fails
 * its condition closed, so it compares no day either.
 */
function listsNeedZone(
  documents: readonly BlockDocument[],
  run: BindingRun | undefined,
  shapesOf: (collection: string) => readonly BindingFieldShape[] | undefined,
  namedQueries: NamedQueryLookup | undefined
): boolean {
  return (
    listCollectionsWhere(
      documents,
      (query, list, collection) =>
        query.filters.some(row => isListDay(row.value)) ||
        ordersADay(
          conditionDemand(list.slots?.[LIST_ENTRY_SLOT] ?? []).orderedFields ??
            new Set(),
          shapesOf(collection)
        ),
      run,
      namedQueries
    ).size > 0
  );
}

/**
 * Whether a list whose source is a named query with rows of its own schema
 * orders a date in its item conditions, and so needs the site's zone: such a
 * list draws no collection, so the collections' walk never asks about it.
 * Its fields are the ones its conditions are judged by (`queryRowFields`).
 */
function customRowsNeedZone(
  documents: readonly BlockDocument[],
  run: BindingRun | undefined,
  namedQueries: NamedQueryLookup | undefined
): boolean {
  if (namedQueries === undefined) return false;
  return anyListWhere(
    documents,
    (query, list) => {
      const name = ownSchemaQuery(query.namedQuery?.name, namedQueries);
      return name !== undefined && rowsOrderADay(list, name, namedQueries);
    },
    run
  );
}

/**
 * The named query a list reads, where its rows are of their own schema
 * (they declare fields), not a collection's entries.
 */
function ownSchemaQuery(
  name: string | undefined,
  namedQueries: NamedQueryLookup
): string | undefined {
  if (name === undefined) return undefined;
  const rows = namedQueries.definitionOf(name)?.rows;
  return rows !== undefined && "fields" in rows ? name : undefined;
}

/** Whether a list's item conditions order a date its query's rows hold. */
function rowsOrderADay(
  list: BlockNode,
  name: string,
  namedQueries: NamedQueryLookup
): boolean {
  return ordersADay(
    conditionDemand(list.slots?.[LIST_ENTRY_SLOT] ?? []).orderedFields ??
      new Set(),
    queryRowFields(namedQueries, name, () => undefined)
  );
}

/** Whether any of `fields` is a date in `shapes`, as a condition reads it. */
function ordersADay(
  fields: ReadonlySet<string>,
  shapes: readonly BindingFieldShape[] | undefined
): boolean {
  if (fields.size === 0 || shapes === undefined) return false;
  return shapes.some(
    shape => fields.has(shape.name) && conditionFieldKind(shape) === "date"
  );
}

/**
 * The site's zone and the field shapes of the collections whose lists filter
 * by a day or decide a block's conditions per entry; nothing when no list
 * does. The zone is read only where a list compares days. The page's
 * bindings' answers are used where they were already read.
 */
export async function listDayInputs(args: {
  terms: PageReadTerms;
  sources: PageReadSources;
  documents: readonly BlockDocument[];
  bindings: PageBindings | undefined;
  where: PageWhere;
}): Promise<Pick<PageContext, "timeZone" | "fieldShapes">> {
  // The page's binding pass, so a list whose collection is bound is asked
  // about the collection it will draw.
  const run =
    args.bindings === undefined
      ? undefined
      : pageBindingRun(args.bindings, args.where.locale, args.terms.resolver);
  // A custom source's items are read as its rows' collection's.
  const namedQueries = args.terms.namedQueries;
  const collections = listsComparingDays(args.documents, run, namedQueries);
  const customDays = customRowsNeedZone(args.documents, run, namedQueries);
  if (collections.size === 0 && !customDays) return {};
  const known = new Map<string, readonly BindingFieldShape[] | undefined>();
  for (const collection of collections) {
    try {
      known.set(collection, await args.sources.fieldShapes(collection));
    } catch {
      known.set(collection, undefined);
    }
  }
  // Asked once the shapes are known, so only a date compared needs the zone.
  const timeZone =
    customDays ||
    listsNeedZone(
      args.documents,
      run,
      collection => known.get(collection),
      namedQueries
    )
      ? await listZone(args)
      : undefined;
  return {
    ...(timeZone === undefined ? {} : { timeZone }),
    fieldShapes: {
      fieldsOf: ref =>
        "collection" in ref ? known.get(ref.collection) : undefined,
    },
  };
}

/** The zone a page's lists compare days in, the site read only when needed. */
async function listZone(args: {
  terms: PageReadTerms;
  sources: PageReadSources;
  bindings: PageBindings | undefined;
  where: PageWhere;
}): Promise<string | undefined> {
  const site =
    args.bindings?.site ??
    (args.terms.timeZone === undefined ? await args.sources.site() : undefined);
  return (
    args.bindings?.timeZone ??
    pageTimeZone(args.terms.timeZone, site ?? undefined, args.where)
  );
}

/**
 * The time zone a page's date-times are shown in: the route's, else the
 * site's, else UTC. A zone the runtime does not know is said once and UTC is
 * used.
 */
export function pageTimeZone(
  routeZone: string | undefined,
  site: BlocksSiteSettings | undefined,
  where: { readonly collection: string; readonly slug: string }
): string | undefined {
  const zone = routeZone ?? site?.timezone ?? undefined;
  if (routeZone === undefined && zone !== undefined) {
    if (!safeTimeZone(zone).valid) {
      console.warn(
        `[blocks] The site's time zone "${zone}" is not one this runtime knows, so bound date-times on "${where.collection}" page "${where.slug}" are shown in UTC.`
      );
    }
  }
  return zone;
}

/**
 * The list a page's address pages, found in the page's own document as the
 * renderer presents it: repaired, and held to the route's caps on nodes and
 * depth. A list the renderer would drop (malformed, past a cap) therefore
 * pages nothing, so the route never serves a later page whose HTML has no
 * list. The page's own nodes only, its components left out: a component or a
 * Layout region shows on many pages, so a list in one never pages an
 * address. The one finding the route's count and the render share.
 */
export function pagedListOf(
  document: BlockDocument,
  page: DrawnDocument,
  maxNodes: number,
  /** The page's binding pass, so a bound query prop is read as drawn. */
  run: BindingRun | undefined
): PaginatedList | undefined {
  if (page.prepared === null) return undefined;
  // The page's own lists, walked in its stored order, an instance's exposed
  // slot included, never one a component's definition brings, which shows
  // on every page placing it. Each is judged by its props as the page's
  // binding pass fills them, the ones it is drawn with, read from that very
  // list in the page as drawn (found by its id, so a component's own list
  // cannot stand in for it): a limit, offset, collection or split bound to
  // the entry counts as the page shows it, so a list split into pages only
  // by a bound value pages too, and the route serves exactly the pages the
  // list's links name. Both walks are held to the route's node cap, as the
  // renderer's own reading is.
  const drawn = listsById(page.prepared.presented.nodes, maxNodes);
  return paginatedList(document.nodes, maxNodes, stored => {
    const list =
      typeof stored.id === "string" ? drawn.get(stored.id) : undefined;
    return list === undefined ? {} : listPropsAsBound(list, run);
  });
}

/**
 * The collection lists in `nodes`, as drawn, by id: the first of each id in
 * document order. Bounded by `maxNodes`.
 */
function listsById(
  nodes: readonly BlockNode[],
  maxNodes: number
): Map<string, BlockNode> {
  const lists = new Map<string, BlockNode>();
  const stack: BlockNode[] = [...nodes].reverse();
  let left = maxNodes;
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (left <= 0) break;
    left -= 1;
    if (node.type === COLLECTION_LIST_TYPE && !lists.has(node.id)) {
      lists.set(node.id, node);
    }
    pushChildren(stack, node);
  }
  return lists;
}

/**
 * A node's children onto a walk's stack, so they pop in document order:
 * its slots in order, each slot's children in order.
 */
function pushChildren(stack: BlockNode[], node: BlockNode): void {
  for (const children of Object.values(node.slots ?? {}).reverse()) {
    for (let at = children.length - 1; at >= 0; at -= 1) {
      const child = children[at];
      if (child !== undefined) stack.push(child);
    }
  }
}

/**
 * Which page of its paginated list a render draws, and the address of each
 * page, or nothing when the page splits no list into pages.
 */
function listPageFor(
  list: PaginatedList | undefined,
  context: PageWhere
): ListPageContext | undefined {
  // The route's own addresses, its mount included: present where it serves
  // a list's later pages, so the links name exactly the pages it answers.
  const listPagePath = context.listPagePath;
  if (listPagePath === undefined || list === undefined) return undefined;
  return {
    nodeId: list.id,
    page: context.page ?? 1,
    href: listPagePath,
    // The route's count, where it served this later page by one.
    ...(context.listPages === undefined ? {} : { pages: context.listPages }),
  };
}

/**
 * The page of its paginated list a render draws, with the list's first read
 * claimed for it, or nothing where the route serves no later pages (a
 * Single's gives no addresses, so its list shows one page and claims its
 * own read) or the list's read cannot be claimed, as the route then serves
 * none of its later pages either.
 *
 * Claimed only for a list that reads: one with no collection yet, or a
 * stored query it cannot run, spends nothing another list needs. A custom
 * source claims nothing ahead: its run claims each read it makes, as the
 * route's count of its pages claimed them.
 */
function claimedListPage(
  list: PaginatedList | undefined,
  context: PageWhere,
  budget: QueryBudget
): ListPageContext | undefined {
  if (
    list === undefined ||
    context.listPagePath === undefined ||
    !listWillRead(list.props)
  ) {
    return undefined;
  }
  if (namedListBase(list.props) !== undefined) {
    return listPageFor(list, context);
  }
  if (!budget.take({ kind: "entries", nodeId: list.id })) return undefined;
  const page = listPageFor(list, context);
  return page === undefined ? undefined : { ...page, claimed: true };
}

/**
 * The binding pass the renderer fills list items' bindings with, built by
 * the renderer's own function from the renderer's own inputs (the page's
 * bindings, language, blocks and named queries), so a list reads ahead for
 * the props each entry is drawn with. None for a page with no bindings,
 * whose items' bindings are not filled.
 */
function itemBindingRunFor(
  bindings: PageBindings | undefined,
  locale: string | undefined,
  resolver: BlockResolver,
  namedQueries: NamedQueryHost | undefined
): BindingRun | undefined {
  return bindings === undefined
    ? undefined
    : pageBindingRun(bindings, locale, resolver, namedQueries);
}

/** The renderer props every document drawn on one page shares. */
export type SharedRendererProps = Pick<
  Parameters<typeof PageRenderer>[0],
  | "context"
  | "blocks"
  | "styleContext"
  | "blockFallback"
  | "limits"
  | "hostPolicy"
  | "bindings"
  | "onBindingIssues"
>;

/** The page's own renderer props, less the site sheet decision. */
export type PageRendererElementProps = Omit<
  Parameters<typeof PageRenderer>[0],
  "siteStyles"
>;

/**
 * The header region, the page, then the footer region, as sibling elements.
 *
 * Each region is wrapped in its landmark, `<header>` or `<footer>`, carrying
 * `data-nextly-region` naming its area. A landmark rather than a plain `div`
 * because that is what a header and a footer ARE to a screen reader moving by
 * region, and the Layout is the only place that knows which is which; the
 * attribute is the stable hook for a host's own CSS or a test, independent of
 * the markup a component draws inside. Neither wrapper adds a style: the
 * region's own page root carries every rule the component compiled to.
 *
 * The site sheet is emitted ONCE, by whichever document is drawn first. Every
 * document's own rules are anchored at one specificity and settled by source
 * order, so the site sheet (block defaults, named classes) has to come before
 * all of them: emitted by the page with a header above it, the block defaults
 * would land AFTER the header's own rules and beat them. The other documents
 * are rendered with `siteStyles={false}` and the page compile context that
 * sheet implies, so their own rules compile exactly as they would beside it.
 *
 * A region's styles reach the page the way a placed component's do: a
 * composed document never matches a stored stylesheet, so its sheet is
 * compiled during the render from the route's compile context.
 */
export function drawWithRegions(args: {
  regions: readonly DrawnRegion[];
  page: PageRendererElementProps;
  shared: SharedRendererProps;
  siteStyles: SiteSheetInput | undefined;
  definitions: DefinitionsById;
}): ReactElement[] {
  const { regions, page, shared, siteStyles, definitions } = args;
  const header = regions.find(part => part.region.area === "header");
  const footer = regions.find(part => part.region.area === "footer");
  // In the order they are drawn: header, page, footer.
  const parts: (DrawnRegion | "page")[] = [
    ...(header === undefined ? [] : [header]),
    "page" as const,
    ...(footer === undefined ? [] : [footer]),
  ];
  // One answer for every surface drawing a page inside its Layout: which part
  // emits the site sheet, and the scope each part compiles under.
  const sheets = layoutPartSheets({
    parts: parts.map(
      (part): PagePart => (part === "page" ? part : part.region.area)
    ),
    styleContext: shared.styleContext,
    siteStyles,
    pageScope:
      typeof page.styles?.scope === "string" ? page.styles.scope : undefined,
  });
  return parts.map((part, index) => {
    const sheet = sheets[index] ?? {};
    if (part === "page") {
      return createElement(PageRenderer, { ...page, ...sheet, key: "page" });
    }
    const area = part.region.area;
    return createElement(
      area,
      { key: area, "data-nextly-region": area },
      createElement(PageRenderer, {
        ...shared,
        // The blocks the renderer keeps for this region's own conditions,
        // from the preparation it draws the region with, not the page's.
        ...(shared.context === undefined
          ? {}
          : {
              context: {
                ...shared.context,
                heldConditions: heldConditionsOf(part.prepared ?? undefined),
              },
            }),
        ...sheet,
        // The document the region was prepared from, so the renderer reuses
        // that preparation rather than running the pipeline again.
        document: part.document,
        ...(definitions.size === 0 ? {} : { definitions }),
        ...(part.prepared === null ? {} : { prepared: part.prepared }),
      })
    );
  });
}

/** What a page render works from, its lists' terms and list page with it. */
export interface StagedPage extends PageInputs {
  /** What a list's date filter compares whole days by. */
  readonly listDays: Pick<PageContext, "timeZone" | "fieldShapes">;
  /** The page of its paginated list drawn, its first read claimed. */
  readonly listPage: ListPageContext | undefined;
}

/**
 * Everything a page render reads before it draws, in the route's order: the
 * page's inputs, the terms its lists compare days by, then the first read of
 * the list it splits into pages, claimed before any block is drawn, which is
 * the order the route counted its pages in. So a block drawn before the list
 * cannot spend the read the count relied on.
 */
export async function readPageStages(args: {
  terms: PageReadTerms;
  sources: PageReadSources;
  document: BlockDocument;
  /** The document fitted to its definitions (`readPageInputs`' `fit`). */
  fit?: (definitions: DefinitionsById) => BlockDocument;
  entrySource: EntrySource;
  where: PageWhere;
  budget: QueryBudget;
  onIssues: BindingIssuesHandler;
}): Promise<StagedPage> {
  const { terms, sources, where } = args;
  const inputs = await readPageInputs(args);
  // Asked of the documents as presented, as the bindings are, so a list
  // inside a component is seen.
  const listDays = await listDayInputs({
    terms,
    sources,
    documents: inputs.presented,
    bindings: inputs.bindings,
    where,
  });
  const pagedList = pagedListOf(
    // The document as read and drawn, fitted where the caller fits it.
    inputs.document,
    inputs.page,
    effectiveLimits(terms).maxNodes,
    inputs.bindings === undefined
      ? undefined
      : pageBindingRun(inputs.bindings, where.locale, terms.resolver)
  );
  const listPage = claimedListPage(pagedList, where, args.budget);
  return { ...inputs, listDays, listPage };
}

/**
 * The context a staged page is drawn under: `base` with its lists' terms,
 * the list page claimed, its lists' read-ahead, the blocks the renderer keeps
 * for the entry's conditions (from the preparation it draws the page with,
 * so a list reads ahead for exactly the blocks it draws; each Layout region
 * gets its own in `drawWithRegions`) and the binding pass its items are
 * filled by.
 */
export function stagedContext(
  base: PageContext,
  staged: StagedPage,
  terms: PageReadTerms,
  listReads: ListBatchReads
): PageContext {
  return {
    ...base,
    ...staged.listDays,
    ...(staged.listPage === undefined ? {} : { listPage: staged.listPage }),
    listReads,
    heldConditions: heldConditionsOf(staged.page.prepared ?? undefined),
    itemBindingRun: itemBindingRunFor(
      staged.bindings,
      base.locale,
      terms.resolver,
      base.namedQueries
    ),
  };
}
