/**
 * What a page reads when it is published, counted where it is edited: the
 * page drawn once more, off screen, with nothing kept and a budget of its
 * own, through the published route's OWN stages (`readPageStages`), in their
 * order, and drawn as the route draws it (`drawWithRegions`).
 *
 * What differs is only where each read is made:
 * - the components the page and its Layout place come from the definitions
 *   the editor holds, each ask claimed in the route's batches, and only the
 *   ones the allowance granted are drawn;
 * - the Layout is the one the editor draws the page inside, its row claimed
 *   as the route claims it;
 * - the bindings and the entry fields the page's conditions check are read
 *   by the caller's `readBindings`, under the reads the page has left at that
 *   point, and what that cost is claimed again here, so a read past the
 *   allowance is refused where the route refuses it;
 * - lists read their entries through the editor's data provider, and their
 *   relations through it too, as the route reads them ahead;
 * - each distinct image is one read, or one per batch of a list's images,
 *   and each link to an entry three (its row and two ownership checks), or
 *   three per batch for a list's links:
 *   counted as the route counts them, without the read, since the editor
 *   draws neither.
 *
 * The caller draws the page (`draw`), since this entry renders with React
 * alone and a server renderer is the caller's to bring.
 *
 * Its known limit: the site's time zone. A list's days are compared in the
 * zone the page's bindings read, else in UTC, since the editor reads no site
 * settings of its own; the read the route makes for it is counted all the
 * same.
 *
 * @module page-read-count
 * @experimental Settles with the editor's read meter.
 */
import {
  DEFAULT_LIMITS,
  isPlainRecord,
  regionDocument,
  type BlockDocument,
  type DefinitionsById,
  type LayoutRegion,
  type RegionArea,
} from "@nextlyhq/blocks-engine";
import { createElement, Fragment, type ReactElement } from "react";

import { relatedThrough } from "./blocks/list-batch";
import { definitionsFor, type ComponentSource } from "./component-source";
import {
  componentBatches,
  createQueryBudget,
  createStandaloneContext,
  DEFAULT_MAX_QUERIES,
  emptyDataProvider,
  READ_KINDS,
  type ListBatchReads,
  type PageBindings,
  type PageContext,
  type PageReadReport,
  type QueryBudget,
  type ReadClaim,
  type ResolvedMedia,
} from "./context";
import {
  drawWithRegions,
  readPageStages,
  readsMediaInBatches,
  stagedContext,
  type BindingsAsk,
  type EntrySource,
  type LayoutRead,
  type PageReadSources,
  type PageReadTerms,
  type PageWhere,
  type RouteMedia,
} from "./page-read-stages";
import type { PageRendererProps } from "./page-renderer";
import { registeredBlocks } from "./resolver";

/**
 * What the page is drawn with where it is edited, which the count draws
 * again.
 *
 * @experimental
 */
export type CountedDrawing = Omit<PageRendererProps, "document" | "siteStyles">;

/**
 * A Layout region the page is drawn inside, as the editor draws it: the
 * region's document (one instance of the component filling the area) and
 * the definitions it reaches.
 *
 * @experimental
 */
export interface CountedRegion {
  readonly area: RegionArea;
  readonly document: BlockDocument;
  readonly definitions?: DefinitionsById;
}

/**
 * What a page's bindings read, and what reading them cost.
 *
 * @experimental
 */
export interface CountedBindings {
  readonly bindings: PageBindings;
  /** The reads they made and were refused, by kind; none for none made. */
  readonly reads?: PageReadReport;
}

/**
 * What a count of a page's reads is made from.
 *
 * @experimental
 */
export interface PageReadCountArgs {
  readonly drawnWith: CountedDrawing;
  readonly document: BlockDocument;
  readonly regions: readonly CountedRegion[];
  /** Where the page's entry lives, which decides whether it has conditions. */
  readonly entrySource: EntrySource;
  /** Where the page is drawn, as its route would resolve it. */
  readonly where: PageWhere;
  /**
   * The page's bindings, and its conditions' entry fields, read as the route
   * reads them, under `allowance` reads (`Infinity` for no limit).
   */
  readonly readBindings: (
    ask: BindingsAsk,
    allowance: number
  ) => Promise<CountedBindings | undefined>;
  /**
   * Draw the page to nowhere, resolving once every async block has settled:
   * the caller's renderer, since this entry renders with React alone.
   */
  readonly draw: (element: ReactElement) => Promise<void>;
  /** The allowance counted against: the default a published page has. */
  readonly cap?: number;
  /**
   * How the route reads media: the collection it reads from, where it names
   * one (a bound image is filled only from an upload field pointing there),
   * and whether it can read a list's images in batches
   * (`readsMediaInBatches`). The default route's, when absent: the media
   * library, read in batches.
   */
  readonly media?: RouteMedia;
}

/** What one link to an entry costs a published page: its row, two checks. */
const LINK_READS = 3;

/** How many ids one batched read takes, as the published page batches them. */
const BATCH_SIZE = 100;

/** Claim `count` reads, stopping at the first refused. */
function claimEach(
  budget: QueryBudget,
  count: number,
  claim: ReadClaim
): boolean {
  for (let read = 0; read < count; read += 1) {
    if (!budget.take(claim)) return false;
  }
  return true;
}

/**
 * Each image once, as the published page reads it; a list's images ahead in
 * batches of {@link BATCH_SIZE}, one read each, asked only where the
 * allowance also covers each image's own read after it, as the published
 * page asks a batch, and then not again per image.
 */
function countedMedia(
  base: PageContext,
  budget: QueryBudget,
  /** Whether the route reads a list's images in batches at all. */
  batches: boolean
): {
  resolve: PageContext["resolveMedia"];
  ahead: NonNullable<ListBatchReads["media"]>;
} {
  const known = new Map<string, Promise<ResolvedMedia | null>>();
  const drawn = (id: string) => {
    const reading = base.resolveMedia(id).catch(() => null);
    known.set(id, reading);
    return reading;
  };
  return {
    resolve: (id, claim) =>
      known.get(id) ??
      (budget.take({ ...claim, kind: "image" })
        ? drawn(id)
        : Promise.resolve(null)),
    ahead: (ids, claim) => {
      // A route that reads each image by its own id reads none ahead, as
      // the route's own resolver answers.
      if (!batches) return Promise.resolve(true);
      const wanted = [...new Set(ids)].filter(id => !known.has(id));
      for (let at = 0; at < wanted.length; at += BATCH_SIZE) {
        const batch = wanted.slice(at, at + BATCH_SIZE);
        if (
          (budget.remaining?.() ?? Infinity) < batch.length + 1 ||
          !budget.take({ ...claim, kind: "image" })
        ) {
          return Promise.resolve(false);
        }
        for (const id of batch) void drawn(id);
      }
      return Promise.resolve(true);
    },
  };
}

/**
 * Links and a list's batches, counted as the published page counts them:
 * one entry's link once, at {@link LINK_READS}; a list's links into one
 * collection at {@link LINK_READS} per batch, and then not again per entry.
 */
function countedLinks(budget: QueryBudget): {
  resolve: PageContext["resolveEntryPath"];
  ahead: ListBatchReads["entryPaths"];
} {
  const known = new Set<string>();
  const key = (collection: string, id: string) => `${collection}\u0000${id}`;
  return {
    // Settled only once every read it needed was granted: a link refused
    // is asked again by the next block that draws it, and named as unread,
    // as the published page's resolver leaves it.
    resolve: (collection, id, claim) => {
      const ref = key(collection, id);
      if (
        !known.has(ref) &&
        claimEach(budget, LINK_READS, { ...claim, kind: "link" })
      ) {
        known.add(ref);
      }
      // The editor draws no address for a link to an entry.
      return Promise.resolve(null);
    },
    ahead: (refs, claim) => {
      for (const ids of unsettled(refs, known, key).values()) {
        for (let at = 0; at < ids.length; at += BATCH_SIZE) {
          const batch = ids.slice(at, at + BATCH_SIZE);
          // Asked only where the allowance also covers each link's own
          // reads after it, as the published page asks a batch.
          if (
            (budget.remaining?.() ?? Infinity) <
            LINK_READS * (batch.length + 1)
          ) {
            return Promise.resolve();
          }
          if (!claimEach(budget, LINK_READS, { ...claim, kind: "link" })) {
            return Promise.resolve();
          }
          for (const id of batch) known.add(id);
        }
      }
      return Promise.resolve();
    },
  };
}

/** The links not yet settled, by collection, each by its kept key. */
function unsettled(
  refs: readonly { readonly collection: string; readonly id: string }[],
  known: ReadonlySet<string>,
  key: (collection: string, id: string) => string
): Map<string, string[]> {
  const byCollection = new Map<string, string[]>();
  for (const { collection, id } of refs) {
    const ref = key(collection, id);
    if (known.has(ref)) continue;
    byCollection.set(collection, [
      ...(byCollection.get(collection) ?? []),
      ref,
    ]);
  }
  return byCollection;
}

/**
 * The reads a binding read reported, claimed again in the count's budget by
 * kind, the refused ones too: what they cost the page at this point of its
 * reads.
 */
function replayReads(reads: PageReadReport | undefined, budget: QueryBudget) {
  if (reads === undefined) return;
  for (const kind of READ_KINDS) {
    for (let read = 0; read < (reads.byKind[kind] ?? 0); read += 1) {
      budget.take({ kind });
    }
  }
  for (let read = 0; read < reads.refused; read += 1) budget.take();
}

/**
 * The components a document places, from the definitions the editor holds,
 * each ask claimed in the batches the route's reads take: only the ones the
 * allowance granted are found, so a component the route is refused is drawn
 * as the route draws it, unavailable.
 */
function heldComponents(
  known: DefinitionsById | undefined,
  budget: QueryBudget
): ComponentSource {
  return (ids, placements) => {
    const wanted = [...new Set(ids)].filter(id => id.trim() !== "");
    const found = new Map<string, BlockDocument>();
    // Named by the placements asking, so a refused batch names them unread.
    for (const batch of componentBatches(wanted, budget, placements)) {
      for (const id of batch) {
        const definition = known?.get(id);
        if (definition !== undefined) found.set(id, definition);
      }
    }
    return Promise.resolve(found);
  };
}

/** The region's Layout entry: the component its one instance places. */
function layoutRegionOf(region: CountedRegion): LayoutRegion | undefined {
  const props = region.document.nodes[0]?.props;
  const componentId = isPlainRecord(props) ? props.componentId : undefined;
  return typeof componentId === "string"
    ? { area: region.area, componentId }
    : undefined;
}

/**
 * The Layout the editor draws the page inside, read as the route reads it:
 * its row, one read, then the components its regions place.
 */
async function heldLayout(
  regions: readonly CountedRegion[],
  budget: QueryBudget,
  limits: PageReadTerms["limits"]
): Promise<LayoutRead> {
  const layout = regions.flatMap(region => {
    const placed = layoutRegionOf(region);
    return placed === undefined ? [] : [placed];
  });
  if (layout.length === 0 || !budget.take({ kind: "component" })) {
    return { regions: [], regionDefinitions: new Map() };
  }
  const known = new Map(
    regions.flatMap(region => [...(region.definitions ?? new Map())])
  );
  const regionDefinitions = await definitionsFor(
    regionDocument(layout),
    heldComponents(known, budget),
    limits ?? DEFAULT_LIMITS
  );
  return { regions: layout, regionDefinitions };
}

/** The reads the count's stages make, each claimed from its `budget`. */
function countedSources(
  args: PageReadCountArgs,
  budget: QueryBudget & { remaining(): number },
  read: { bindings?: PageBindings }
): PageReadSources {
  const { drawnWith } = args;
  return {
    components: heldComponents(drawnWith.definitions, budget),
    layout: () => heldLayout(args.regions, budget, drawnWith.limits),
    bindings: async ask => {
      const answer = await args.readBindings(ask, budget.remaining());
      replayReads(answer?.reads, budget);
      read.bindings = answer?.bindings;
      return answer?.bindings;
    },
    fieldShapes: collection =>
      Promise.resolve(
        (read.bindings ?? drawnWith.bindings)?.fieldShapes?.fieldsOf({
          collection,
        })
      ),
    // Claimed as the route claims it; the editor reads no site settings,
    // so a list's days are compared in UTC (this module's known limit).
    site: () => {
      budget.take();
      return Promise.resolve(undefined);
    },
  };
}

/**
 * What the page reads when published, under one budget of `cap`: the
 * published route's stages, then the page drawn once, off screen, inside its
 * Layout, as the route draws it.
 *
 * @experimental Settles with the editor's read meter.
 */
export async function countPageReads(
  args: PageReadCountArgs
): Promise<PageReadReport> {
  const budget = createQueryBudget(args.cap ?? DEFAULT_MAX_QUERIES);
  const {
    // What the route reads for itself, never the editor's.
    definitions: _definitions,
    prepared: _prepared,
    bindings: _bindings,
    context: drawnContext,
    ...drawing
  } = args.drawnWith;
  const resolver = drawing.blocks ?? registeredBlocks();
  const terms: PageReadTerms = {
    resolver,
    limits: drawing.limits,
    styleContext: drawing.styleContext,
    namedQueries: drawnContext?.namedQueries,
    mediaCollection: args.media?.mediaCollection,
  };
  const staged = await readPageStages({
    terms,
    sources: countedSources(args, budget, {}),
    document: args.document,
    entrySource: args.entrySource,
    where: args.where,
    budget,
    // What the page could not check is the editor's to say, not the count's.
    onIssues: () => undefined,
  });
  const {
    // Lists an author chose to see empty, or that wait for an input, read
    // nothing in the editor and read on the published page; and the list
    // page is the stages' to claim.
    listsShowingEmpty: _empty,
    listsStillShowing: _still,
    listPage: _listPage,
    ...base
  } = drawnContext ?? createStandaloneContext();
  const links = countedLinks(budget);
  const media = countedMedia(
    base,
    budget,
    readsMediaInBatches(args.media ?? {})
  );
  const counting: PageContext = {
    ...base,
    queries: budget,
    resolveMedia: media.resolve,
    resolveEntryPath: links.resolve,
  };
  // The route's own relation read, through the editor's data provider, so
  // the rows come back and what a list draws through them (a link or an
  // image by a related entry's field) is counted too.
  const listReads: ListBatchReads = {
    related: relatedThrough(
      base.data ?? emptyDataProvider,
      staged.bindings?.fieldShapes,
      budget
    ),
    entryPaths: links.ahead,
    media: media.ahead,
  };
  const shared = {
    ...drawing,
    context: stagedContext(counting, staged, terms, listReads),
    blocks: resolver,
    ...(staged.bindings === undefined ? {} : { bindings: staged.bindings }),
  };
  await args.draw(
    createElement(
      Fragment,
      null,
      ...drawWithRegions({
        regions: staged.regions,
        page: {
          ...shared,
          document: args.document,
          ...(staged.definitions.size === 0
            ? {}
            : { definitions: staged.definitions }),
          ...(staged.page.prepared === null
            ? {}
            : { prepared: staged.page.prepared }),
        },
        shared,
        siteStyles: undefined,
        definitions: staged.regionDefinitions,
      })
    )
  );
  return budget.report();
}
