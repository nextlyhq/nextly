/**
 * The documents a route draws: the one an entry stores (composed into its
 * template where it has one), the components it embeds, read in one batched
 * and tagged read with drafts overlaid where the route may show them, and the
 * Layout regions a page is drawn inside.
 *
 * Reachable only from `next.ts`, because its reads go through
 * `nextly/runtime`: the package root stays usable with no CMS behind it.
 *
 * @module next-documents
 */
import {
  composeEntryContent,
  DOCUMENT_FORMAT_VERSION,
  regionDocument,
  type BlockDocument,
  type DefinitionsById,
  type LayoutRegion,
} from "@nextlyhq/blocks-engine";
import {
  cachedFind,
  entryIdTag,
  releaseBoundedRevalidate,
} from "nextly/runtime";
import type {
  ContentEntry,
  NextlyContentReader,
  RenderContext,
} from "nextly/runtime";

import {
  COMPONENT_DOCUMENT_FIELD,
  COMPONENT_TAG_COLLECTION,
  definitionsFor,
  EMPTY_DEFINITIONS,
  type ComponentSource,
} from "./component-source";
import { componentBatches, placementsOf } from "./context";
import type { ComponentPlacements, QueryBudget, ReadClaim } from "./context";
import {
  cappedLifetime,
  DEFAULT_LAYOUTS_COLLECTION,
  regionsFor,
  type BlocksLayoutsProvider,
  type LayoutRowReader,
} from "./next-layouts";
import type { BlocksPageConfig } from "./next-page-config";
import { readerFor } from "./next-readers";
import { effectiveLimits } from "./page-read-stages";

/** An empty page, for a field that exists and holds no document yet. */
function emptyDocument(): BlockDocument {
  return { formatVersion: DOCUMENT_FORMAT_VERSION, kind: "page", nodes: [] };
}

/**
 * Each entry's drawn document, by the field it is read from, composed once
 * per entry the route resolved: its metadata, its list's pages and its render
 * are asked of the same entry, and so of one composition.
 */
const DRAWN_DOCUMENTS = new WeakMap<ContentEntry, Map<string, BlockDocument>>();

/**
 * The document a route draws `entry` with: what `field` stores, with the
 * entry's own blocks content composed into a template's Entry content block.
 *
 * Read from the entry as the route read it, with the public's access, so a
 * field the public may not read is absent and draws nothing, and nothing of
 * it reaches the page. A page that is no template is drawn as it is stored.
 * Composed before anything reads the page, so the entry's blocks are drawn,
 * styled, bound, paged and described with the template's, as one document.
 * Reads nothing itself: it is the entry the route already holds.
 */
export function drawnDocumentOf(
  entry: ContentEntry,
  field: string,
  context: RenderContext,
  config: BlocksPageConfig
): BlockDocument {
  let byField = DRAWN_DOCUMENTS.get(entry);
  const kept = byField?.get(field);
  if (kept !== undefined) return kept;
  const document = composedFor(entry, field, context, config);
  if (byField === undefined) {
    byField = new Map();
    DRAWN_DOCUMENTS.set(entry, byField);
  }
  byField.set(field, document);
  return document;
}

/**
 * The document a route draws `entry` with, composed under the page's own
 * limits, so the entry's blocks are cut where the page is; given the
 * definitions of the components the page places, the template is charged
 * what it draws once they are expanded, so every instance still resolves.
 */
function composedFor(
  entry: ContentEntry,
  field: string,
  context: RenderContext,
  config: BlocksPageConfig,
  definitions?: DefinitionsById
): BlockDocument {
  const { maxNodes, maxDepth } = effectiveLimits(config);
  return composeEntryContent(readDocument(entry, field, context), {
    valueOf: name => entry[name],
    maxNodes,
    maxDepth,
    ...(definitions === undefined ? {} : { definitions }),
  });
}

/**
 * The drawn document fitted to the definitions read for it (`composedFor`),
 * for `readPageInputs`' `fit`: the page as first drawn where it places no
 * component, so nothing is composed twice for a page that need not be.
 */
export function fittedFor(
  entry: ContentEntry,
  field: string,
  context: RenderContext,
  config: BlocksPageConfig
): (definitions: DefinitionsById) => BlockDocument {
  return definitions =>
    definitions.size === 0
      ? drawnDocumentOf(entry, field, context, config)
      : composedFor(entry, field, context, config, definitions);
}

/**
 * The document stored at `field`, or an empty page.
 *
 * The two nothing-cases are deliberately NOT treated alike. A field absent from
 * the row is a wiring mistake — a typo, or a route pointed at a collection that
 * has no such field — and it can only ever render blank, so it throws naming
 * both the field and the collection. A field present and null is an entry
 * nobody has authored yet, which is ordinary, and renders empty.
 *
 * Anything else goes to the renderer as-is rather than being inspected here:
 * the renderer already repairs a malformed document forgivingly, and a second
 * opinion about shape in front of it could only disagree with the first.
 */
function readDocument(
  entry: ContentEntry,
  field: string,
  context: RenderContext
): BlockDocument {
  if (!(field in entry)) {
    throw new Error(
      `createBlocksPage: no field "${field}" on an entry from "${context.collection}". ` +
        "Name the field that holds the block document."
    );
  }
  const value = entry[field];
  if (value === null || value === undefined) return emptyDocument();
  return value as BlockDocument;
}

/**
 * The route's component source: one batched, tagged, posture-carrying read.
 *
 * TAGGED PER ID and never with the collection tag. `nextlyTags` always
 * prepends it, so using it here would make publishing any component rebuild
 * every page on the site that embeds any component at all — the exact opposite
 * of what a component store is for. The id tags attach to the PAGE's cache
 * entry because this read happens inside the page's render, so one component
 * publish invalidates exactly the pages that embedded it.
 *
 * The identity channels are cleared and the scope is the route's, for the
 * reasons `mediaResolver` clears them: `mergeConfig` spreads the reader's
 * defaults UNDER the call, so an omitted `user` or `req` restores whatever
 * identity the instance was booted with — on a read this route performs for an
 * anonymous visitor, into a page that is then cached. And the lifecycle scope
 * is the entry read's, not a second opinion: a route serving published content
 * must not inline a draft component, and a preview route must.
 *
 * The row is handed over WHOLE and unjudged. Whether that field holds a
 * readable component document is the pipeline's question, and it answers it
 * with reasons a store cannot: an id present with an unreadable value is a
 * definition somebody published and cannot be read, and an id absent is one
 * nobody published.
 */
export function componentSource(
  config: BlocksPageConfig,
  reader: NextlyContentReader,
  budget: QueryBudget,
  locale: string | undefined
): ComponentSource {
  if (config.resolveComponents) {
    const custom = config.resolveComponents;
    // Charged like every other read on this path, for the reason
    // `mediaResolver` charges a host's own resolver: a site's source is the
    // one most likely to be database- or network-backed, and exempting it
    // bounds the reader we wrote while leaving unbounded the one a site
    // supplies. A nested chain asks it once per level, so an uncharged source
    // is `MAX_COMPOSED_DEPTH` unbounded reads on a route that stated a limit.
    return async (ids, placements) =>
      budget.take({
        ...COMPONENT_CLAIM,
        nodeIds: placementsOf(ids, placements),
      })
        ? await custom(ids)
        : EMPTY_DEFINITIONS;
  }
  const collection = config.componentCollection ?? COMPONENT_TAG_COLLECTION;
  const field = config.componentField ?? COMPONENT_DOCUMENT_FIELD;
  const status = embeddedStatus(config);
  const overlayDrafts = overlaysDrafts(config);

  return async (ids: readonly string[], placements) => {
    // Dropped before anything is built from them, not repaired. `entryIdTag`
    // refuses a blank segment by THROWING — correctly, because a bare
    // `nextly:components:id:` tag would over-invalidate — and a stored
    // `componentId` of `"   "` is a nonempty string that `componentIdsIn`
    // reports as a reference. Left in, one malformed instance takes the whole
    // page down before a block boundary exists to contain it; left out, it is
    // an id nobody supplied a definition for, which is exactly what it is.
    const wanted = usableIds(ids);
    if (wanted.length === 0) return EMPTY_DEFINITIONS;

    const found = new Map<string, BlockDocument>();
    if (overlayDrafts) {
      return await readDraftDefinitions(wanted, {
        reader,
        collection,
        field,
        locale,
        budget,
        placements,
      });
    }
    // One claim per query, by the batches every count of component reads
    // takes (`componentBatches`); charging nothing would leave the read on
    // this path that grows with the page unbounded.
    for (const chunk of componentBatches(wanted, budget, placements)) {
      const page = await readRowsChunk(chunk, {
        reader,
        collection,
        status,
        locale,
        cacheScope: config.cacheScope,
        keyName: "nextly-components",
      });
      for (const [id, document] of definitionsById(page.items, field)) {
        found.set(id, document);
      }
    }
    return found;
  };
}

/** Distinct ids with something in them; see `componentSource` for why. */
export function usableIds(ids: readonly string[]): string[] {
  return [...new Set(ids)].filter(id => id.trim().length > 0);
}

/**
 * The lifecycle scope a route reads what its page EMBEDS at: the components it
 * places and the Layout it is drawn inside. The entry read's own scope, not a
 * second opinion.
 */
function embeddedStatus(
  config: BlocksPageConfig
): "published" | "draft" | "all" {
  return config.status ?? (config.draft === true ? "all" : "published");
}

/**
 * Whether this route may surface PENDING edits of what its page embeds.
 *
 * One answer for components and Layouts alike, so a preview never draws a
 * draft header around a page whose draft components it refused, or the
 * reverse.
 */
function overlaysDrafts(config: BlocksPageConfig): boolean {
  const status = embeddedStatus(config);
  // Whether this route may surface a component's PENDING edits.
  //
  // Both halves are load-bearing, and both are about what this read can
  // HONESTLY promise.
  //
  // Only the LITERAL `draft` counts. A per-path `draft` function answers about
  // the one entry a visitor asked for and says nothing about the components
  // inside it, so a route whose gate is such a function keeps reading published
  // definitions rather than inheriting a grant that was never about them.
  //
  // And the scope must be the unnarrowed one. `findByID` accepts no `status`,
  // and under `overrideAccess` an absent status is no filter at all, so the
  // per-id read cannot express a lifecycle scope and falls back to the live row
  // when no pending snapshot exists. A route that named `status: "draft"` would
  // then receive a PUBLISHED component it had excluded. Which states are public
  // is the workflow's question, answered in the query service, so this narrows
  // by declining the per-id route rather than by re-deciding that rule here —
  // `status: "all"` is the only scope that excludes nothing and can therefore
  // be served by an unfiltered read.
  return config.draft === true && status === "all";
}

/**
 * The route's Layout read: the rows for some ids, at the posture the route
 * reads what its page embeds, tagged per id and never with the collection.
 *
 * The component read's machinery, not a copy of it: the same batched, cached,
 * release-bounded read on a published route, and the same uncached per-id
 * draft read on a route that overlays drafts. Only `id` and `areas` are
 * selected, which is all a region needs.
 */
function layoutRowReader(
  config: BlocksPageConfig,
  provider: BlocksLayoutsProvider,
  reader: NextlyContentReader,
  budget: QueryBudget,
  locale: string | undefined
): LayoutRowReader {
  const collection = provider.collection ?? DEFAULT_LAYOUTS_COLLECTION;
  const status = embeddedStatus(config);
  const overlayDrafts = overlaysDrafts(config);
  return async (ids, options) => {
    const wanted = usableIds(ids);
    if (wanted.length === 0) return [];
    if (overlayDrafts) {
      return await readDraftRows(wanted, {
        reader,
        collection,
        locale,
        budget,
        // Depth zero, as on the published read below.
        depth: 0,
      });
    }
    if (!budget.take(COMPONENT_CLAIM)) return [];
    const found = await readRowsChunk(wanted, {
      reader,
      collection,
      status,
      locale,
      cacheScope: config.cacheScope,
      // A capped read is its own entry, so the cap reaches only the pages
      // whose answer it gives.
      keyName:
        options?.maxLifetime === undefined
          ? "nextly-layouts"
          : `nextly-layouts:${String(options.maxLifetime)}`,
      select: { id: true, areas: true },
      // Depth zero: a region needs only the component ids `areas` stores, and
      // the components are read once more, at the route's posture, by the
      // component read. A populated read would load them, and whatever they
      // relate to, for nothing.
      depth: 0,
      ...(options?.maxLifetime === undefined
        ? {}
        : { maxLifetime: options.maxLifetime }),
    });
    return found.items;
  };
}

/**
 * How many definitions one query may ask for.
 *
 * The smaller of two caps that are enforced elsewhere and silent when crossed.
 * Nextly clamps a collection query to 500 rows (`PAGINATION_DEFAULTS.maxLimit`),
 * so a larger `limit` returns a SUBSET and the components missing from it are
 * reported as though nobody had published them. Next drops cache tags past
 * `NEXT_CACHE_TAG_MAX_ITEMS`, 128 in the version this package builds against,
 * so a component whose tag was dropped is never invalidated by its own publish
 * and stays stale until some unrelated write busts the entry.
 *
 * 128 satisfies both. A page embedding more components than that costs one
 * extra query per 128, which is the honest price of staying invalidatable.
 */

/** What a read of components or Layout rows claims as. */
const COMPONENT_CLAIM: ReadClaim = { kind: "component" };

/**
 * The definitions a DRAFT-mode route reads, one query per component.
 *
 * PER ID because that is the only shape the working draft is reachable in. The
 * overlay is applied in `collection-query-service.getEntry`; the list path has
 * no equivalent, so a batched `find` returns the LIVE row however wide its
 * `status` — `status: "all"` widens which rows match and never reaches a
 * pending edit. A route previewing an edit would then draw the last published
 * component, and the form and the picture beside it would disagree about the
 * document the author is looking at.
 *
 * UNCACHED, for the reason `resolve-content` gives for never caching a draft
 * entry read: a working draft changes on every save while cache tags are burst
 * by writes to the LIVE row, so a cached draft shows an editor their previous
 * save and calls it a preview. That also means there is no tag or key to get
 * right here — the staleness a key could not fix is the whole objection.
 *
 * The price is one query per component instead of one per page, and it is paid
 * ONLY here. Draft mode is the editor iframe: one author, one request, no
 * shared cache entry to protect. The published path serves every visitor and
 * keeps its batch, which is what the `overlayDrafts` gate above is for.
 *
 * `draft: true` is an opt-in the service still gates on an update-capability
 * probe, which `overrideAccess` satisfies — the same trust the batched read
 * already carries, and the same identity channels cleared for the same reason.
 */
async function readDraftDefinitions(
  wanted: readonly string[],
  args: {
    reader: NextlyContentReader;
    collection: string;
    field: string;
    locale: string | undefined;
    budget: QueryBudget;
    /** Who asks for each id, named unread when its read is refused. */
    placements: ComponentPlacements | undefined;
  }
): Promise<DefinitionsById> {
  const { field, placements, ...rest } = args;
  // Through the SAME reader the batched path uses, so a row is judged readable
  // by one rule. A second unwrapping here is how the two paths would come to
  // disagree about which stored value counts as a definition.
  return definitionsById(
    await readDraftRows(wanted, {
      ...rest,
      // Each id's own read, refused, names the placements asking for it and
      // every later id's, since a refusal ends the reads.
      claimAt: at => ({
        ...COMPONENT_CLAIM,
        nodeIds: placementsOf(wanted.slice(at), placements),
      }),
    }),
    field
  );
}

/**
 * The working-draft rows for `wanted`, one uncached query per id.
 *
 * The per-id half of {@link readDraftDefinitions}, kept apart so the Layout
 * read on a draft route takes the same path, at the same price and with the
 * same identity channels cleared, as the component read beside it.
 */
async function readDraftRows(
  wanted: readonly string[],
  args: {
    reader: NextlyContentReader;
    collection: string;
    locale: string | undefined;
    budget: QueryBudget;
    /** Relationship depth, for a read that needs only the ids it stores. */
    depth?: number;
    /** The claim the read of the id at `at` is made with; unnamed if none. */
    claimAt?: (at: number) => ReadClaim;
  }
): Promise<Record<string, unknown>[]> {
  const { reader, collection, locale, budget, depth } = args;
  const rows: Record<string, unknown>[] = [];
  for (const [at, id] of wanted.entries()) {
    // One claim per QUERY, exactly as the batched path charges. Here that is
    // one per row, which is the honest price of this read rather than a
    // penalty: a page whose reads outrun the allowance stops fetching and the
    // remainder resolve as missing, with a marker, instead of the route
    // issuing unbounded reads.
    if (!budget.take(args.claimAt?.(at))) break;
    const row = await reader.findByID({
      collection,
      id,
      draft: true,
      overrideAccess: true,
      disableErrors: true,
      user: undefined,
      req: undefined,
      ...(locale ? { locale } : {}),
      ...(depth === undefined ? {} : { depth }),
    });
    if (row !== null && row !== undefined) rows.push(row);
  }
  return rows;
}

/**
 * One batched, tagged, posture-carrying read of at most a full chunk.
 *
 * Shared by the component read and the Layout read, which ask the same
 * question of different collections: these ids, at the route's posture, tagged
 * per id. `keyName` keeps their cache entries apart, and `select` narrows a
 * read that needs only some columns.
 */
async function readRowsChunk(
  wanted: readonly string[],
  args: {
    reader: NextlyContentReader;
    collection: string;
    status: "published" | "draft" | "all";
    locale: string | undefined;
    cacheScope: string | undefined;
    keyName: string;
    select?: Record<string, boolean>;
    /** A cap, in seconds, on top of the release bound. */
    maxLifetime?: number;
    /** Relationship depth, for a read that needs only the ids it stores. */
    depth?: number;
  }
): Promise<{ items: Record<string, unknown>[] }> {
  const {
    reader,
    collection,
    status,
    locale,
    cacheScope,
    keyName,
    select,
    maxLifetime,
    depth,
  } = args;
  // How long this read may live, bounded by the next scheduled release —
  // asked for the reason `release-cache-window` states about the two callers
  // it already had: a release member names a scope, and a bound applied to
  // some cached reads and not others leaves the unwired one serving its
  // pre-release content. This is a third such read, so it is a third place
  // that has to ask.
  //
  // Without it the entry is created with `revalidate: false`, so at the
  // release instant the page read around it refreshes while this one stays a
  // cache hit — and the page keeps drawing the pre-release component until
  // some unrelated write happens to bust its id tag.
  const release = await releaseBoundedRevalidate(undefined);
  const revalidate =
    maxLifetime === undefined ? release : cappedLifetime(release, maxLifetime);
  return await cachedFind(
    async () =>
      await reader.find({
        collection,
        where: { id: { in: [...wanted] } },
        limit: wanted.length,
        status,
        overrideAccess: true,
        disableErrors: true,
        user: undefined,
        req: undefined,
        ...(locale ? { locale } : {}),
        ...(select === undefined ? {} : { select }),
        ...(depth === undefined ? {} : { depth }),
      }),
    {
      tags: wanted.map(id => entryIdTag(collection, id)),
      keyParts: [
        keyName,
        collection,
        status,
        locale ?? "",
        // The tenant discriminator, exactly as `resolveContent` keys its own
        // read. Two deployments pointed at different databases ask for the
        // same component ids under the same collection, status and locale —
        // so without this the first to warm the entry serves its definitions
        // to the other's pages.
        cacheScope ?? "",
        // Sorted, so two pages embedding the same components in a different
        // order share one entry rather than filling two with one answer.
        ...[...wanted].sort(),
      ],
      revalidate,
    }
  );
}

/** The rows a batched read returned, keyed by id, with the block field taken. */
function definitionsById(
  items: readonly Record<string, unknown>[],
  field: string
): DefinitionsById {
  const found = new Map<string, BlockDocument>();
  for (const item of items) {
    const id = item.id;
    if (typeof id !== "string") continue;
    // Whatever the field held. A row present with an unusable value is what
    // lets the pipeline say `unreadable` rather than `missing`, so nothing is
    // filtered out here.
    found.set(id, item[field] as BlockDocument);
  }
  return found;
}

/**
 * The regions a page is drawn inside, and the components they draw: none when
 * the route draws no Layout.
 *
 * The regions' components come through the page's own source, so they are
 * read at the page's posture and locale, tagged by id, and charged to the
 * same budget.
 */
export async function layoutRegions(args: {
  config: BlocksPageConfig;
  provider: BlocksLayoutsProvider | undefined;
  entry: ContentEntry;
  locale: string | undefined;
  budget: QueryBudget;
}): Promise<{
  regions: readonly LayoutRegion[];
  regionDefinitions: DefinitionsById;
}> {
  const { config, provider, entry, locale, budget } = args;
  if (provider === undefined) {
    return { regions: [], regionDefinitions: EMPTY_DEFINITIONS };
  }
  const regions = await regionsFor({
    provider,
    entry,
    readRows: layoutRowReader(
      config,
      provider,
      readerFor(config),
      budget,
      locale
    ),
    budget,
    cacheScope: config.cacheScope,
  });
  const regionDefinitions =
    regions.length === 0
      ? EMPTY_DEFINITIONS
      : await definitionsFor(
          regionDocument(regions),
          componentSource(config, readerFor(config), budget, locale),
          effectiveLimits(config)
        );
  return { regions, regionDefinitions };
}
