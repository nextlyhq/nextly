/**
 * The reads a routed page's stages make, each claimed from the page's
 * budget: records by id, Singles, the site settings, the public's field
 * shapes, what a page's bindings read, and what its lists read ahead for
 * their entries.
 *
 * Reachable only from `next.ts`, because its reads go through
 * `nextly/runtime`: the package root stays usable with no CMS behind it.
 *
 * @module next-read-sources
 */
import {
  bindingDemand,
  safeTimeZone,
  type BindingDemand,
  type BindingFieldShape,
  type BlockDocument,
  type ConditionDemand,
  type SourceDemand,
} from "@nextlyhq/blocks-engine";
import {
  bindingFieldShapes,
  cachedFind,
  nextlyTags,
  releaseBoundedRevalidate,
  nextlySingleTags,
  nextlySiteSettingsTags,
  readPublicSiteSettings,
} from "nextly/runtime";
import type {
  ContentEntry,
  PublicSiteSettingsSource,
  RenderContext,
} from "nextly/runtime";

import { recordedFieldShapes, shapeRefKey } from "./binding-wire";
import {
  judgedStep,
  itemFollowsIn,
  relatedThrough,
  relationTarget,
} from "./blocks/list-batch";
import type {
  BlocksDataProvider,
  BlocksFieldShapeRef,
  BlocksFieldShapes,
  BlocksPublicReader,
  BlocksSiteSettings,
  NamedQueryLookup,
  PageBindings,
  ListBatchReads,
  QueryBudget,
  ReadKind,
} from "./context";
import { listCollections } from "./list-collections";
import { componentSource, layoutRegions } from "./next-documents";
import type { EntryPathReads } from "./next-entry-paths";
import type { BlocksLayoutsProvider } from "./next-layouts";
import {
  MEDIA_TAG_COLLECTION,
  mediaNamespaceOf,
  type MediaReads,
} from "./next-media";
import type { BlocksPageConfig } from "./next-page-config";
import {
  readerFor,
  publicReaderFor,
  ProcessSiteSettings,
  warnOfStandIn,
  siteSettingsSourceFor,
} from "./next-readers";
import {
  pageTimeZone,
  type EntrySource,
  type PageReadSources,
  type PageReadTerms,
} from "./page-read-stages";
import type { BlockResolver } from "./resolver";

/**
 * The route's media library, for a binding that follows into it; none where
 * the route draws its images from a collection of its own
 * (`mediaCollection`), whose rows the public reader finds, or where its
 * reader has no library.
 */
function mediaLibraryOf(
  config: BlocksPageConfig
): Pick<BindingSourcesArgs, "media"> {
  if (config.mediaCollection !== undefined) return {};
  const library = mediaNamespaceOf(readerFor(config));
  return library === undefined ? {} : { media: library };
}

/** What a source read needs: the reader, the page's budget, the shapes. */
interface SourceReads {
  readonly reader: BlocksPublicReader;
  readonly budget: QueryBudget;
  readonly shapes: BlocksFieldShapes;
  /** The media library, which a relation into `media` is read from. */
  readonly media?: BindingSourcesArgs["media"];
}

/** How a read is cached: the route's scope, the page's language and window. */
interface ReadCache {
  readonly scope: string;
  readonly locale: string | undefined;
  readonly window: number | false | undefined;
}

/** A record as the public reads it; `null` for none, `undefined` for unread. */
type PublicRecord = Readonly<Record<string, unknown>> | null | undefined;

/**
 * One entry of a collection, by id, as the public reads it, with only the
 * named fields: one claim on the page's budget.
 */
async function readById(
  reads: SourceReads,
  collection: string,
  id: string | number,
  fields: readonly string[],
  kind: ReadKind
): Promise<PublicRecord> {
  if (!reads.budget.take({ kind })) return undefined;
  try {
    // An editor's reader reads by id, which alone returns the working draft
    // of an entry with one pending; a published page's reads as a list does.
    if (reads.reader.findById !== undefined) {
      return await reads.reader.findById({
        collection,
        id,
        select: fields,
      });
    }
    const { items } = await reads.reader.find({
      collection,
      filters: [{ field: "id", op: "equals", value: id }],
      limit: 1,
      select: fields,
    });
    return items[0] ?? null;
  } catch {
    return undefined;
  }
}

/**
 * A media library item a binding follows into, read as the page's images
 * are, through the library rather than as a collection's row: `media` is no
 * collection the public reader finds, and asking it for one fails the read.
 * Only the named fields are kept, as a row's read selects them; one claim.
 */
async function readMediaById(
  reads: SourceReads,
  media: NonNullable<BindingSourcesArgs["media"]>,
  id: string,
  fields: readonly string[]
): Promise<PublicRecord> {
  if (!reads.budget.take({ kind: "related" })) return undefined;
  try {
    const record = await media.findByID({ id, disableErrors: true });
    if (record === null) return null;
    return Object.fromEntries(
      ["id", ...fields]
        .filter(field => Object.hasOwn(record, field))
        .map(field => [field, record[field]])
    );
  } catch {
    return undefined;
  }
}

/** One Single as the public reads it, with only the named fields: one claim. */
async function readSingle(
  reads: SourceReads,
  slug: string,
  fields: readonly string[]
): Promise<PublicRecord> {
  const findSingle = reads.reader.findSingle?.bind(reads.reader);
  if (findSingle === undefined || !reads.budget.take({ kind: "page" })) {
    return undefined;
  }
  try {
    // The route's public reader caches it, tagged with the Single, so a write
    // to it refreshes the pages that bind it.
    return await findSingle({ slug, select: fields });
  } catch {
    return undefined;
  }
}

/**
 * A record with each relation its bindings follow read in place of its id,
 * through the public reader by id: one claim per relation. The public reader
 * returns a relation as its id, so this is the one hop a path may take. A
 * relation the schema does not describe, or a read that is refused, is left
 * as it was, and a binding through it shows its fallback.
 */
async function withRelations(
  record: PublicRecord,
  demand: SourceDemand,
  ref: BlocksFieldShapeRef,
  reads: SourceReads
): Promise<PublicRecord> {
  if (record === null || record === undefined) return record;
  const fields = reads.shapes.fieldsOf(ref);
  let followed: Readonly<Record<string, unknown>> = record;
  for (const [name, inner] of demand.follows) {
    const target = relationTarget(fields, name);
    const id = record[name];
    if (target === undefined) continue;
    if (typeof id !== "string" && typeof id !== "number") continue;
    const related =
      target === MEDIA_TAG_COLLECTION && reads.media !== undefined
        ? await readMediaById(reads, reads.media, String(id), inner)
        : await readById(reads, target, id, inner, "related");
    if (related !== undefined) followed = { ...followed, [name]: related };
  }
  return followed;
}

/**
 * The entry as the public reads it, with the fields the page binds.
 *
 * Read AGAIN rather than taken from the route: a public route resolves its
 * entry with trusted access, and a draft preview resolves the draft, so the
 * row in hand may hold fields and versions no visitor may see. A Single's page
 * reads its Single; a collection's, its entry by id.
 */
async function readPublicEntry(args: {
  demand: SourceDemand;
  slug: string;
  entryId: unknown;
  entrySource: EntrySource;
  entryRef: BlocksFieldShapeRef;
  reads: SourceReads;
}): Promise<PublicRecord> {
  const { demand, slug, reads } = args;
  let record: PublicRecord;
  if (args.entrySource === "single") {
    record = await readSingle(reads, slug, demand.fields);
  } else {
    const id = args.entryId;
    if (typeof id !== "string" && typeof id !== "number") return undefined;
    record = await readById(reads, slug, id, demand.fields, "page");
  }
  return await withRelations(record, demand, args.entryRef, reads);
}

/** Each Single the page binds, as the public reads it; an unread one is left out. */
async function readSingles(
  demand: ReadonlyMap<string, SourceDemand>,
  reads: SourceReads
): Promise<Map<string, Readonly<Record<string, unknown>> | null>> {
  const singles = new Map<string, Readonly<Record<string, unknown>> | null>();
  for (const [slug, wanted] of demand) {
    const record = await withRelations(
      await readSingle(reads, slug, wanted.fields),
      wanted,
      { single: slug },
      reads
    );
    if (record !== undefined) singles.set(slug, record);
  }
  return singles;
}

/**
 * The site settings the public may read, from `from`, or from the process's
 * registered instance when it is `undefined`: one claim, cached under the
 * settings' own tag, so changing the site's name or time zone refreshes the
 * pages that show them. A stand-in for a reader without the read is named
 * before it is read, whether or not the cache then answers.
 *
 * The cache key holds the route's `cacheScope`, as every public read of a
 * route does: two routes over different instances in one process name their
 * own scopes, or their pages share one site's settings. The key cannot be
 * derived from the instance itself, since the cache outlives the process and
 * an instance has no name that is the same in the next one.
 */
export async function readSite(
  from: PublicSiteSettingsSource | undefined,
  cacheScope: string | undefined,
  budget: QueryBudget,
  window: number | false | undefined
): Promise<BlocksSiteSettings | undefined> {
  // One read per page request: the bindings, the lists' zone and a named
  // query's day all ask the same question, and a request holds one budget,
  // so the first ask claims the read and the rest share its answer.
  const key = cacheScope ?? "";
  let asked = siteReadsByRequest.get(budget);
  if (asked === undefined) {
    asked = new Map();
    siteReadsByRequest.set(budget, asked);
  }
  const known = asked.get(key);
  if (known !== undefined) return await known;
  const reading = readSiteOnce(from, cacheScope, budget, window);
  asked.set(key, reading);
  return await reading;
}

/**
 * The site-settings reads a page request has made, by its query budget (one
 * per request) and cache scope: dropped with the request's budget.
 */
const siteReadsByRequest = new WeakMap<
  QueryBudget,
  Map<string, Promise<BlocksSiteSettings | undefined>>
>();

/** One read of the site settings, claimed from `budget`. */
async function readSiteOnce(
  from: PublicSiteSettingsSource | undefined,
  cacheScope: string | undefined,
  budget: QueryBudget,
  window: number | false | undefined
): Promise<BlocksSiteSettings | undefined> {
  if (from instanceof ProcessSiteSettings) warnOfStandIn(from);
  if (!budget.take()) return undefined;
  try {
    return await cachedFind(async () => await readPublicSiteSettings(from), {
      tags: nextlySiteSettingsTags(),
      keyParts: ["nextly-public-site-settings", cacheScope ?? ""],
      revalidate: await releaseBoundedRevalidate(window),
    });
  } catch {
    return undefined;
  }
}

/**
 * One source's field shapes, as `bindingFieldShapes` answers them in the
 * page's language, cached like the page and tagged with the source.
 *
 * Cached because the answer judges which fields the public may read, and that
 * judgement takes the current time to check the access rules are current: a
 * prerender under Cache Components refuses that outside the cache. `null`
 * stands for "no shapes" inside the cache, which keeps values as JSON.
 */
export async function cachedFieldShapes(
  ref: BlocksFieldShapeRef,
  cache: ReadCache
): Promise<readonly BindingFieldShape[] | undefined> {
  const shapes = await cachedFind(
    async () =>
      (await bindingFieldShapes(
        ref,
        cache.locale === undefined ? {} : { locale: cache.locale }
      )) ?? null,
    {
      tags:
        "collection" in ref
          ? nextlyTags(ref.collection)
          : nextlySingleTags(ref.single),
      keyParts: [
        "nextly-binding-field-shapes",
        cache.scope,
        cache.locale ?? "",
        shapeRefKey(ref),
      ],
      revalidate: await releaseBoundedRevalidate(cache.window),
    }
  );
  return shapes ?? undefined;
}

/**
 * The field shapes every binding on the page is checked against: the entry's,
 * each Single's, each collection a path follows into, and each list's items'.
 * Read in the page's language, as the visitor sees them; a source it cannot
 * answer for has none, and its bindings are judged by their values.
 */
async function readFieldShapes(
  entryRef: BlocksFieldShapeRef,
  demand: BindingDemand,
  lists: readonly string[],
  cache: ReadCache,
  /** The relations the lists' items follow, whose targets are read too. */
  itemFollows: ReadonlySet<string> = new Set()
): Promise<BlocksFieldShapes> {
  const known = new Map<string, readonly BindingFieldShape[] | undefined>();
  // Lookups that failed: asked once, and not recorded. A recorded `undefined`
  // means the source has no field a visitor may read (or no such source), an
  // answer an editor's canvas acts on; a failed lookup is no answer at all.
  const failed = new Set<string>();
  const fetch = async (ref: BlocksFieldShapeRef) => {
    const key = shapeRefKey(ref);
    if (known.has(key) || failed.has(key)) return known.get(key);
    try {
      const shapes = await cachedFieldShapes(ref, cache);
      known.set(key, shapes);
      return shapes;
    } catch {
      failed.add(key);
      return undefined;
    }
  };
  const sources: [BlocksFieldShapeRef, SourceDemand][] = [
    ...(demand.entry === undefined
      ? []
      : [[entryRef, demand.entry] as [BlocksFieldShapeRef, SourceDemand]]),
    ...[...demand.singles].map(
      ([slug, wanted]) =>
        [{ single: slug }, wanted] as [BlocksFieldShapeRef, SourceDemand]
    ),
  ];
  for (const [ref, wanted] of sources) {
    const fields = await fetch(ref);
    for (const name of wanted.follows.keys()) {
      const target = relationTarget(fields, name);
      if (target !== undefined) await fetch({ collection: target });
    }
  }
  for (const collection of lists) {
    const fields = await fetch({ collection });
    // A list item's binding through a relation is judged by the related
    // collection's public shapes, as the entry's is.
    for (const name of itemFollows) {
      const target = relationTarget(fields, name);
      if (target !== undefined) await fetch({ collection: target });
    }
  }
  // Recorded, so the shapes read can be sent whole to an editor's canvas.
  return recordedFieldShapes(known);
}

/**
 * What a binding-source read is given: the documents drawn, where the page's
 * entry is and who reads it.
 *
 * @experimental Settles with the editor's binding sources.
 */
export interface BindingSourcesArgs {
  /** The documents drawn, as the read pipeline prepared them. */
  readonly documents: readonly BlockDocument[];
  /**
   * The media library, as the page's images are read from it: a relation a
   * binding follows into the built-in `media` collection (an image's alt text
   * from the entry's featured image) is read here by id, since `media` is no
   * collection the public reader finds. Absent, such a relation is not
   * followed, and its bindings show their fallbacks.
   */
  readonly media?: {
    findByID(args: {
      id: string;
      disableErrors?: boolean;
    }): Promise<Record<string, unknown> | null>;
  };
  /**
   * What the bindings read, when the caller has worked it out already: the
   * editor's canvas works it out from the document it draws and sends only
   * that. Absent, it is read from `documents`.
   */
  readonly demand?: BindingDemand;
  /**
   * The collections the page's lists draw, whose public field shapes judge
   * their items' bindings, when the caller has worked them out already with
   * `listCollections`, as the editor's canvas does. Absent, they are read
   * from `documents`.
   */
  readonly lists?: readonly string[];
  /**
   * The site's named queries, so a custom source's list is asked about the
   * collection its rows are entries of, whose fields its items bind by,
   * where `lists` is read from `documents`. Undefined, such a list's items
   * are judged by their values.
   */
  readonly namedQueries?: NamedQueryLookup | undefined;
  /** Whether the page's entry is a collection's entry or a Single. */
  readonly entrySource: "collection" | "single";
  /** The collection, or the Single, the page's entry belongs to. */
  readonly slug: string;
  /** The entry's id, for a collection's entry. */
  readonly entryId?: unknown;
  /** The page, for what is said about it: its address or its slug. */
  readonly page: string;
  /** The language the sources are read in. */
  readonly locale?: string;
  /**
   * Who reads the entry, the Singles and each relation a path follows: a
   * published page's public reader, or an editor's reader that reads as the
   * person editing. The site settings and the field shapes are the public's
   * whoever reads: the same for everyone, and holding no one's data.
   */
  readonly reader: BlocksPublicReader;
  /** The page's read budget, which every source read claims from. */
  readonly budget: QueryBudget;
  /** The route's cache scope, for the public, shared reads. */
  readonly cacheScope?: string;
  /**
   * The instance the site settings are read from: the one the page's records
   * come from. Absent, the process's registered instance, as before.
   */
  readonly siteSettings?: PublicSiteSettingsSource;
  /** The route's own time zone, which wins over the site's. */
  readonly timeZone?: string;
  /** The release window the public, shared reads are bounded by. */
  readonly window?: number | false;
  /**
   * What the page's blocks' visibility conditions read of its entry, read in
   * the same one read of the entry as its bindings'.
   */
  readonly conditions?: ConditionDemand;
}

/**
 * What a page's bindings read, through `args.reader`, or nothing when the
 * documents it draws hold no binding.
 *
 * Asked of each document as the read pipeline prepared it: composed,
 * migrated, gated, de-duplicated and with its known placeholders removed, so
 * a node the page does not present claims no read. A published page passes
 * its public reader; the editor's canvas passes a reader that reads as the
 * person editing, so the two answer the same question by one implementation.
 *
 * @experimental Settles with the editor's binding sources.
 */
export async function readBindingSources(
  args: BindingSourcesArgs
): Promise<PageBindings | undefined> {
  // Prepared trees are already within the pipeline's caps, and a composed
  // tree may run deeper than a stored one, so no cap is applied again.
  const demand = withConditions(
    args.demand ?? bindingDemand(args.documents),
    args.conditions
  );
  if (!demand.any) return undefined;
  const entryRef: BlocksFieldShapeRef =
    args.entrySource === "single"
      ? { single: args.slug }
      : { collection: args.slug };
  const lists = args.lists ?? [
    ...listCollections(args.documents, args.namedQueries),
  ];
  const shapes = await readFieldShapes(
    entryRef,
    demand,
    lists,
    {
      scope: args.cacheScope ?? "",
      locale: args.locale,
      window: args.window,
    },
    itemFollowsIn(args.documents)
  );
  const reads: SourceReads = {
    reader: args.reader,
    budget: args.budget,
    shapes,
    ...(args.media === undefined ? {} : { media: args.media }),
  };
  const entry =
    demand.entry === undefined
      ? undefined
      : await readPublicEntry({
          demand: demand.entry,
          slug: args.slug,
          entryId: args.entryId,
          entrySource: args.entrySource,
          entryRef,
          reads,
        });
  const singles = await readSingles(demand.singles, reads);
  return {
    ...(entry === undefined ? {} : { entry }),
    entryRef,
    singles,
    ...(await siteAndZone(args, demand)),
    fieldShapes: shapes,
  };
}

/**
 * A page's read demand with what its visibility conditions read added: the
 * entry fields they check, read in the same one read of the entry as its
 * bindings', and the site's zone when one orders a value, which may compare
 * days. The entry is read for conditions alone when nothing binds it, since a
 * condition the page cannot check would hide its block.
 */
function withConditions(
  demand: BindingDemand,
  conditions: ConditionDemand | undefined
): BindingDemand {
  if (conditions === undefined || !conditions.any) return demand;
  const fields = new Set([
    ...(demand.entry?.fields ?? []),
    ...conditions.entryFields,
  ]);
  return {
    ...demand,
    any: true,
    formatsDates: demand.formatsDates || conditions.ordersValues,
    ...(fields.size === 0
      ? {}
      : {
          entry: {
            fields: [...fields],
            follows: demand.entry?.follows ?? new Map(),
          },
        }),
  };
}

/**
 * Said once, when a route is built, of a `timeZone` the runtime does not know:
 * every page would otherwise show its date-times in UTC with nothing saying
 * why.
 */
export function warnOfUnknownTimeZone(zone: string | undefined): void {
  if (zone === undefined || safeTimeZone(zone).valid) return;
  console.warn(
    `[blocks] timeZone "${zone}" is not a time zone this runtime knows, so bound date-times are shown in UTC.`
  );
}

/**
 * The site settings a page needs, when its bindings name one or a date-time
 * needs the site's zone, and the zone its date-times are shown in.
 */
async function siteAndZone(
  args: Pick<
    BindingSourcesArgs,
    | "slug"
    | "page"
    | "budget"
    | "cacheScope"
    | "siteSettings"
    | "timeZone"
    | "window"
  >,
  demand: BindingDemand
): Promise<{ site?: BlocksSiteSettings; timeZone?: string }> {
  const needsZone = demand.formatsDates && args.timeZone === undefined;
  const site =
    demand.site || needsZone
      ? await readSite(
          args.siteSettings,
          args.cacheScope,
          args.budget,
          args.window
        )
      : undefined;
  const timeZone = pageTimeZone(args.timeZone, site, {
    collection: args.slug,
    slug: args.page,
  });
  return {
    ...(site === undefined ? {} : { site }),
    ...(timeZone === undefined ? {} : { timeZone }),
  };
}

/** What a route draws its pages under, beyond what they read. */
export function readTermsOf(
  config: BlocksPageConfig,
  resolver: BlockResolver
): PageReadTerms {
  return {
    resolver,
    limits: config.limits,
    styleContext: config.styleContext,
    timeZone: config.timeZone,
    namedQueries: config.namedQueries,
    mediaCollection: config.mediaCollection,
  };
}

/**
 * The reads a routed page's stages make, through the route's instance and
 * under its budget: its components and its Layout's rows at the posture the
 * route reads what it embeds, its bindings' sources and the site settings as
 * the public reads them, and the public's field shapes, cached like the page.
 */
export function routeReadSources(args: {
  config: BlocksPageConfig;
  entry: ContentEntry;
  context: RenderContext;
  entrySource: EntrySource;
  layoutsProvider: BlocksLayoutsProvider | undefined;
  window: number | false | undefined;
  budget: QueryBudget;
}): PageReadSources {
  const { config, entry, context, budget, window } = args;
  const cache: ReadCache = {
    scope: config.cacheScope ?? "",
    locale: context.locale,
    window,
  };
  return {
    components: componentSource(
      config,
      readerFor(config),
      budget,
      context.locale
    ),
    layout: async () =>
      await layoutRegions({
        config,
        provider: args.layoutsProvider,
        entry,
        locale: context.locale,
        budget,
      }),
    bindings: async ask =>
      await readBindingSources({
        documents: ask.documents,
        entrySource: args.entrySource,
        slug: context.collection,
        entryId: entry.id,
        page: context.slug,
        ...(context.locale === undefined ? {} : { locale: context.locale }),
        reader: publicReaderFor(config, context.locale, window),
        // The library the route's images come from, so a binding into a
        // media item (its alt text) is read as those images are.
        ...mediaLibraryOf(config),
        budget,
        ...(config.cacheScope === undefined
          ? {}
          : { cacheScope: config.cacheScope }),
        // The route's instance, as its records are read through, so the
        // page shows its own site's settings and never the process's.
        siteSettings: siteSettingsSourceFor(config),
        ...(config.timeZone === undefined ? {} : { timeZone: config.timeZone }),
        ...(window === undefined ? {} : { window }),
        // A custom source's items bind as entries of its rows' collection.
        namedQueries: config.namedQueries,
        ...(ask.conditions === undefined ? {} : { conditions: ask.conditions }),
      }),
    fieldShapes: async collection =>
      await cachedFieldShapes({ collection }, cache),
    site: async () =>
      await readSite(
        siteSettingsSourceFor(config),
        config.cacheScope,
        budget,
        window
      ),
  };
}

/**
 * What a page's lists read ahead for their entries:
 * - relations through the page's own data provider, the one its lists read
 *   their entries through, so whatever the provider refuses a list (a
 *   collection it does not serve) it refuses a list's relations too: the
 *   items keep their ids and their bindings show their fallbacks. Judged by
 *   the public's field shapes. Never through any other reader;
 * - links through the page's own resolver, whose answers the entries'
 *   blocks then take without a read of their own. A link names where this
 *   route serves an entry and is read under the route's own posture, as the
 *   same link outside a list is, so a batched link answers as that one does.
 */
export function listBatchReads(args: {
  readonly data: BlocksDataProvider;
  readonly shapes: BlocksFieldShapes | undefined;
  readonly budget: QueryBudget;
  readonly entryPaths: EntryPathReads;
  readonly media: MediaReads;
}): ListBatchReads {
  const { data, shapes, budget } = args;
  return {
    related: relatedThrough(data, shapes, budget),
    // Each step's own answer to whether it primed what it was asked, kept
    // for the scheduler; the published methods answer nothing.
    entryPaths: judgedStep(args.entryPaths.ahead),
    media: judgedStep(args.media.ahead),
  };
}
