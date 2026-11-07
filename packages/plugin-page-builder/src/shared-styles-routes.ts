/**
 * The shared styles' own routes: lock and unlock one, read how widely each is
 * used and where, and remove the unused ones.
 *
 * Locking and removing each have ONE door. The site-style Single refuses a
 * lock moved or a style removed by any other write
 * (`refuseSharedStyleChangesOutsideTheirRoutes`, beside the Single), so these
 * routes are where the permission to lock is asked, and where removal is
 * checked against the usage index, then against the stored documents
 * themselves ({@link shared-style-rescan}), just before the write.
 *
 * Usage comes from the class usage index, through the same listing the
 * component counts are derived from, so a count, its split by kind and the
 * where-used list cannot disagree. A class inside gated or hidden content is
 * counted, because the index records every node the compiler reads.
 *
 * Concurrency: each write here reads the class list and writes it back whole,
 * with the version of its read, so another save in between refuses it rather
 * than being overwritten. The route then reads again, makes its checks on
 * what is stored now and makes only its own change there ({@link
 * stale-retry}), so a concurrent change to another class is kept.
 *
 * ## What serializes a removal with a first use
 *
 * The composition graph lock (`composition-graph-lock`). The checks here are
 * the early refusal, naming a document the caller may open; a page saved
 * between them and the write is not seen by them. So every write of the site
 * style that drops a shared style, this route's, a whole-list write and an
 * undo alike, takes the lock inside its own transaction and reads the stored
 * documents again under it (`site-style-removal-lock`), and a page write
 * adding a reference judges it again under the same lock against the classes
 * read then (`composition-rejudge`). Whichever takes the lock first commits
 * before the other is judged, so a page cannot commit a first use of a style
 * the removal took out, and a removal cannot take out a style a page just
 * started applying.
 *
 * ## What isn't closed
 *
 * A class applied in a blocks value inside a named group, a repeater's rows
 * or a field-group instance: the validation judges top-level blocks fields
 * only, and so does the judgement under the lock.
 *
 * @module shared-styles-routes
 */
import {
  getCachedNextly,
  NextlyError,
  respondDoc,
  respondList,
  respondMutation,
  type PluginRouteContext,
  type PluginRoutePermissionScope,
} from "@nextlyhq/plugin-sdk";
import type { WhereFilter } from "nextly";
import { z } from "nextly/zod";

import { classUsageOf } from "./class-usage";
import {
  storedFormsReader,
  type ClassUsageDirectApi,
  type StoredDocumentForm,
} from "./class-usage-runtime";
import { documentVersionOf, withVersionFrom } from "./document-version";
import { titleFieldIn } from "./entries-route";
import { entryOf, findAsCaller, singleReadableByCaller } from "./entry-reads";
import { chunked, ID_BATCH_SIZE } from "./id-batches";
import {
  SHARED_STYLE_COUNT_ROUTE_PATH,
  SHARED_STYLE_ID_PARAM,
  SHARED_STYLE_IN_USE_CODE,
  SHARED_STYLE_LOCK_ROUTE_PATH,
  SHARED_STYLE_PAGE_PARAM,
  SHARED_STYLE_REMOVE_ROUTE_PATH,
  SHARED_STYLE_USAGE_IDS_MAX,
  SHARED_STYLE_USAGE_ROUTE_PATH,
  SHARED_STYLE_WHERE_USED_MAX,
  SHARED_STYLE_WHERE_USED_PAGES_MAX,
  SHARED_STYLE_WHERE_USED_ROUTE_PATH,
  type SharedStyleLockRequest,
  type SharedStyleRemoveRequest,
  type SharedStylesCountResponse,
  type SharedStylesUsageResponse,
  type SharedStyleUsage,
  type SharedStyleUsageKind,
  type SharedStyleUseItem,
} from "./library-contract";
import {
  RESCAN_PAGE_SIZE,
  refuseStoredUses,
  storedUsesOf,
  type StoredDocuments,
  type StoredUse,
} from "./shared-style-rescan";
import {
  collectionsTheBuilderOpens,
  siteLocales,
  singlesTheBuilderOpens,
  type LocalizedConfig,
  type SiteStyleRouteContext,
} from "./site-style-route";
import {
  SHARED_STYLE_LOCK_WRITE_CONTEXT,
  SITE_STYLE_SLUG,
  sharedStyleName,
} from "./site-style-storage";
import { retryOnStale } from "./stale-retry";
import { readStoredJson } from "./stored-json";
import { USAGE_BACKFILL_JOB } from "./usage-backfill-job";
import { documentCountOf, type DocumentsUsing } from "./usage-count";
import {
  indexIsWhole,
  indexStillCounting,
  type UsageIndexHealth,
} from "./usage-index-health";

/** The permission that locks and unlocks shared styles, in its parts. */
const LOCK_SHARED_STYLES = {
  action: "lock",
  resource: "page-builder-shared-styles",
} as const;

/**
 * The permission as the plugin declares it: distinct from the right to change
 * Design, so a lock protects a style from every Design manager without it.
 */
export const LOCK_SHARED_STYLES_DECLARATION: {
  readonly action: string;
  readonly resource: string;
  readonly label: string;
  readonly description: string;
} = {
  action: LOCK_SHARED_STYLES.action,
  resource: LOCK_SHARED_STYLES.resource,
  label: "Lock shared styles",
  description:
    "Lock and unlock the site's shared styles. A locked style can't be changed, renamed or removed.",
};

/** The same permission as a route declares it. */
export const LOCK_SHARED_STYLES_PERMISSION: string = `${LOCK_SHARED_STYLES.action}-${LOCK_SHARED_STYLES.resource}`;

/** The stored entries, as stored, and the version of the read they came from. */
export interface SharedStyleRead {
  /** As stored, unknown keys kept. */
  readonly entries: Record<string, unknown>[];
  /** The Single's version as read; absent from a server that issues none. */
  readonly rev: string | undefined;
}

/** The stored class list, read and written as the routes need it. */
export interface SharedStyleStore {
  read(): Promise<SharedStyleRead>;
  /**
   * Store the whole list, marked as the named route's write. `from` is the
   * read the list was made from: its version goes with the write, so a save
   * of the Single since refuses it rather than being overwritten.
   */
  write(
    classes: readonly Record<string, unknown>[],
    context: Readonly<Record<string, unknown>>,
    from: SharedStyleRead
  ): Promise<void>;
}

/** The usage index, as the routes read it. */
export interface SharedStyleUsageSource {
  /** The index's health, read once per request. */
  health(): Promise<UsageIndexHealth>;
  /**
   * The documents using each class asked about, by collection, in a bounded
   * number of reads however many are asked.
   */
  documentsUsingEach(
    classIds: readonly string[],
    health: UsageIndexHealth
  ): Promise<ReadonlyMap<string, DocumentsUsing>>;
  /** Which kind of document a collection holds. */
  kindOf(collection: string): SharedStyleUsageKind;
}

/**
 * The documents of one collection the caller may read, by id and title, or
 * `null` when the caller may read none of that collection.
 */
export type ReadNamedDocuments = (
  collection: string,
  ids: readonly string[]
) => Promise<readonly { id: string; title: string }[] | null>;

/**
 * A Single's title as the where-used list names it, or `null` when the
 * caller may not read it.
 */
export type ReadNamedSingle = (slug: string) => Promise<string | null>;

/** A refusal naming what is wrong with a request body. */
export function invalidRequest(message: string): NextlyError {
  return NextlyError.validation({
    errors: [{ path: "", code: "INVALID_VALUE", message }],
  });
}

/** A request's JSON body, or `undefined` when it is not JSON. */
export async function jsonBody(req: Request): Promise<unknown> {
  try {
    return JSON.parse(await req.text()) as unknown;
  } catch {
    return undefined;
  }
}

/** A class id as the engine bounds one. */
const CLASS_ID = z.string().min(1).max(128);

const LockBody = z.strictObject({ classId: CLASS_ID, locked: z.boolean() });

const RemoveBody = z.strictObject({
  ids: z.array(CLASS_ID).min(1).max(SHARED_STYLE_USAGE_IDS_MAX),
});

/**
 * Lock or unlock one stored shared style.
 *
 * Authorized by the route's declared permission before this runs. A style the
 * site defines only in code has no stored entry to lock, and is refused rather
 * than given one, since a stored entry would override the code's. A write
 * refused because the Single was saved meanwhile is made again on what is
 * stored then, changing only this style's lock.
 */
export async function lockSharedStyle(
  req: Request,
  store: SharedStyleStore,
  configClassIds: ReadonlySet<string>
): Promise<Response> {
  const parsed = LockBody.safeParse(await jsonBody(req));
  if (!parsed.success) {
    throw invalidRequest("Name the shared style with classId, and say locked.");
  }
  const { classId, locked } = parsed.data satisfies SharedStyleLockRequest;
  return retryOnStale(
    () => store.read(),
    read => lockOn(read, store, { classId, locked }, configClassIds)
  );
}

/** One attempt at a lock: the style's lock set on `read`, and written from it. */
async function lockOn(
  read: SharedStyleRead,
  store: SharedStyleStore,
  { classId, locked }: SharedStyleLockRequest,
  configClassIds: ReadonlySet<string>
): Promise<Response> {
  const classes = read.entries;
  const at = classes.findIndex(entry => entry.id === classId);
  const entry = classes[at];
  if (entry === undefined) {
    if (configClassIds.has(classId)) {
      throw NextlyError.conflict({
        reason: "state",
        message:
          "This shared style is defined in the site's code, so it can't be locked here.",
        logContext: { classId },
      });
    }
    throw NextlyError.notFound({
      message: "There is no shared style with this id.",
      logContext: { classId },
    });
  }
  const name = sharedStyleName(entry);
  const message = locked ? `${name} is locked.` : `${name} is unlocked.`;
  // Already as asked: nothing to write, and the answer is the same.
  if ((entry.locked === true) === locked)
    return respondMutation(message, entry);
  const { locked: _was, ...unlocked } = entry;
  const next = locked ? { ...unlocked, locked: true } : unlocked;
  await store.write(
    classes.map((current, index) => (index === at ? next : current)),
    SHARED_STYLE_LOCK_WRITE_CONTEXT,
    read
  );
  return respondMutation(message, next);
}

/** The ids a usage read asks about: one or more, at most one page of rows. */
function usageIds(url: string): string[] {
  const ids = [
    ...new Set(new URL(url).searchParams.getAll(SHARED_STYLE_ID_PARAM)),
  ];
  const parsed = z
    .array(CLASS_ID)
    .min(1)
    .max(SHARED_STYLE_USAGE_IDS_MAX)
    .safeParse(ids);
  if (!parsed.success) {
    throw invalidRequest(
      `Name between 1 and ${SHARED_STYLE_USAGE_IDS_MAX} shared styles with ?id=.`
    );
  }
  return parsed.data;
}

/**
 * A listing for an id a read did not answer for. Not complete: nothing vouched
 * for it, so its zero is a floor.
 */
export const NOTHING_FOUND: DocumentsUsing = {
  collections: [],
  complete: false,
};

const NO_KINDS: Readonly<Record<SharedStyleUsageKind, number>> = {
  pages: 0,
  components: 0,
  patterns: 0,
  layouts: 0,
};

/** One listing as a usage: its count, the same documents by kind. */
export function usageOf(
  found: DocumentsUsing,
  kindOf: (collection: string) => SharedStyleUsageKind
): SharedStyleUsage {
  const byKind = { ...NO_KINDS };
  for (const entry of found.collections) {
    byKind[kindOf(entry.collection)] += entry.documents.length;
  }
  return {
    documents: documentCountOf(found),
    byKind,
    complete: found.complete,
  };
}

/**
 * How widely each named shared style is used, with the index's health and
 * whether this caller may lock styles.
 *
 * Counts are read as the system, since the index refuses every other reader,
 * and name no document: they say how many, not which.
 */
export async function readSharedStyleUsage(
  req: Request,
  ctx: Pick<PluginRouteContext, "caller" | "self">,
  usage: SharedStyleUsageSource
): Promise<SharedStylesUsageResponse> {
  const ids = usageIds(req.url);
  const health = await usage.health();
  // One read for the whole page of styles, not one per style.
  const found = await usage.documentsUsingEach(ids, health);
  // Built from entries, so every id is an own key: an id like `__proto__`,
  // assigned to a plain object, would set its prototype and be lost.
  const styles: Record<string, SharedStyleUsage> = Object.fromEntries(
    ids.map(id => [
      id,
      usageOf(found.get(id) ?? NOTHING_FOUND, collection =>
        usage.kindOf(collection)
      ),
    ])
  );
  const mayLock =
    (await ctx.caller?.can(
      LOCK_SHARED_STYLES.action,
      LOCK_SHARED_STYLES.resource
    )) ?? false;
  return {
    whole: indexIsWhole(health),
    // From the same health reading, so it cannot disagree with `whole`.
    counting: indexStillCounting(health),
    mayLock,
    mayCount: await mayCountSharedStyleUsage(ctx),
    styles,
  };
}

/** What a where-used read asks for: one style, and which page of its uses. */
const WhereUsedQuery = z.object({
  id: CLASS_ID,
  // 1-based. Bounded by the most documents one listing can name, so a page
  // past every use is still a small number.
  page: z.coerce
    .number()
    .int()
    .min(1)
    .max(SHARED_STYLE_WHERE_USED_PAGES_MAX)
    .default(1),
});

/** The style a where-used read asks about, and the page. */
function whereUsedQuery(url: string): { id: string; page: number } {
  const params = new URL(url).searchParams;
  const parsed = WhereUsedQuery.safeParse({
    id: params.get(SHARED_STYLE_ID_PARAM) ?? undefined,
    page: params.get(SHARED_STYLE_PAGE_PARAM) ?? undefined,
  });
  if (!parsed.success) {
    throw invalidRequest(
      "Name the shared style with ?id=, and a page from 1 with ?page=."
    );
  }
  return parsed.data;
}

/** The listing for one style, through the batch read. */
export async function listingOf(
  usage: SharedStyleUsageSource,
  id: string,
  health: UsageIndexHealth
): Promise<DocumentsUsing> {
  return (
    (await usage.documentsUsingEach([id], health)).get(id) ?? NOTHING_FOUND
  );
}

/**
 * One order for the readable documents, by collection then id, compared by
 * code unit so it is the same on every server. The index and the as-caller
 * reads both answer in no stated order, and the where-used list is paged by
 * slicing, so without it two requests could slice different orders and a
 * page could repeat one document and drop another.
 */
function byCollectionThenId(
  a: SharedStyleUseItem,
  b: SharedStyleUseItem
): number {
  if (a.collection !== b.collection)
    return a.collection < b.collection ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/**
 * Every document of a listing the caller may read, by collection then id,
 * and how many it may not: each collection's read as the caller, a batch at a
 * time. Bounded by the listing, which the index read bounds.
 */
export async function readableUses(
  found: DocumentsUsing,
  usage: SharedStyleUsageSource,
  readers: { named: ReadNamedDocuments; single: ReadNamedSingle }
): Promise<{ readable: SharedStyleUseItem[]; hidden: number }> {
  const readable: SharedStyleUseItem[] = [];
  let hidden = 0;
  for (const { collection, documents, single } of found.collections) {
    // A Single's one document, named by its label, if the caller may read it.
    if (single === true) {
      const named = await readers.single(collection);
      if (named === null) hidden += 1;
      else readable.push({ id: "", title: named, collection, kind: "pages" });
      continue;
    }
    const ids = documents.filter((doc): doc is string => doc !== null);
    const kind = usage.kindOf(collection);
    for (const batch of chunked(ids, ID_BATCH_SIZE)) {
      const named = (await readers.named(collection, batch)) ?? [];
      hidden += batch.length - named.length;
      for (const doc of named) {
        readable.push({ id: doc.id, title: doc.title, collection, kind });
      }
    }
  }
  return { readable: readable.sort(byCollectionThenId), hidden };
}

/**
 * The documents a shared style is used on, read as the caller, a page of
 * twenty at a time.
 *
 * The index names the documents; each is read as the caller, so only readable
 * ones are listed and the rest are counted in `meta.hiddenCount`. `meta.total`
 * and the pages count the readable documents, the list being paged.
 */
export async function readSharedStyleUses(
  req: Request,
  usage: SharedStyleUsageSource,
  readNamed: ReadNamedDocuments,
  readSingle: ReadNamedSingle
): Promise<Response> {
  const { id, page } = whereUsedQuery(req.url);
  const found = await listingOf(usage, id, await usage.health());
  const { readable, hidden } = await readableUses(found, usage, {
    named: readNamed,
    single: readSingle,
  });
  return respondWithUsesPage(readable, page, {
    hidden,
    complete: found.complete,
  });
}

/**
 * One page of a where-used list, twenty at a time, in the canonical list
 * envelope: `meta.total` and the pages count the uses listed, and
 * `meta.hiddenCount` the documents the caller may not read.
 */
export function respondWithUsesPage<TItem>(
  uses: readonly TItem[],
  page: number,
  listing: { readonly hidden: number; readonly complete: boolean }
): Response {
  const limit = SHARED_STYLE_WHERE_USED_MAX;
  const totalPages = Math.max(1, Math.ceil(uses.length / limit));
  return respondList(uses.slice((page - 1) * limit, page * limit), {
    total: uses.length,
    page,
    limit,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
    hiddenCount: listing.hidden,
    // Documents the index has not counted yet are a source this list could
    // not consult, named so the screen says the list may be short.
    ...(listing.complete ? {} : { notConsulted: ["uncounted-documents"] }),
  });
}

/**
 * What the stored entries say against removing each id: defined in code, or
 * locked. A missing one is refused outright, as an id the caller made up.
 */
function storedRefusals(
  ids: readonly string[],
  classes: readonly Record<string, unknown>[],
  configClassIds: ReadonlySet<string>
): { reasons: UsageReason[]; removable: { id: string; name: string }[] } {
  const reasons: UsageReason[] = [];
  const removable: { id: string; name: string }[] = [];
  for (const id of ids) {
    const entry = classes.find(current => current.id === id);
    if (configClassIds.has(id)) {
      reasons.push({
        id,
        message: `${entry === undefined ? id : sharedStyleName(entry)} is defined in the site's code.`,
        used: false,
      });
    } else if (entry === undefined) {
      throw NextlyError.notFound({
        message: "There is no shared style with this id.",
        logContext: { classId: id },
      });
    } else if (entry.locked === true) {
      reasons.push({
        id,
        message: `${sharedStyleName(entry)} is locked.`,
        used: false,
      });
    } else {
      removable.push({ id, name: sharedStyleName(entry) });
    }
  }
  return { reasons, removable };
}

/**
 * One thing the usage index says against a removal: about one of the ids
 * asked (`id`), or about the whole request; and whether it is a use.
 */
export interface UsageReason {
  readonly id?: string;
  readonly message: string;
  readonly used: boolean;
}

/**
 * What a usage index says against removing each entry: not whole, so no
 * count can be trusted; or an entry used, or not countable in full. `noun`
 * is what is being removed ("shared style", "variable"), for the words.
 */
export async function usageRefusals(
  removable: readonly { id: string; name: string }[],
  usage: SharedStyleUsageSource,
  noun: string
): Promise<UsageReason[]> {
  const health = await usage.health();
  if (!indexIsWhole(health)) {
    return [
      {
        message: `Some pages haven't been counted yet, so no ${noun} can be removed.`,
        used: false,
      },
    ];
  }
  const reasons: UsageReason[] = [];
  const counted = await usage.documentsUsingEach(
    removable.map(entry => entry.id),
    health
  );
  for (const { id, name } of removable) {
    // An id the read did not answer for is one it cannot vouch for.
    const found = counted.get(id) ?? NOTHING_FOUND;
    const documents = documentCountOf(found);
    if (documents > 0) {
      reasons.push({
        id,
        message: `${name} is used on ${documents} ${documents === 1 ? "document" : "documents"}.`,
        used: true,
      });
    } else if (!found.complete) {
      reasons.push({
        id,
        message: `${name}'s uses could not all be counted.`,
        used: false,
      });
    }
  }
  return reasons;
}

/**
 * The refusal for the reasons found against a removal, the one rule both
 * removal routes refuse by. The in-use refusal, carrying
 * {@link SHARED_STYLE_IN_USE_CODE}, only when every reason is a use, so the
 * editor reads every "it is used" alike, whichever check found it, and the
 * code never marks a reason that is not one; any other is a conflict naming
 * every reason. `pathOf` files one issue per reason at its id's path; without
 * it the one issue names every reason. Either way nothing is half removed.
 */
export function removalRefusalOf(
  reasons: readonly UsageReason[],
  logContext: Record<string, unknown>,
  pathOf?: (id: string) => string
): NextlyError {
  const message = `Nothing was removed. ${reasons.map(reason => reason.message).join(" ")}`;
  if (reasons.length === 0 || !reasons.every(reason => reason.used)) {
    return NextlyError.conflict({ reason: "state", message, logContext });
  }
  return NextlyError.validation({
    errors:
      pathOf === undefined
        ? [{ path: "", code: SHARED_STYLE_IN_USE_CODE, message }]
        : reasons.map(reason => ({
            path: reason.id === undefined ? "" : pathOf(reason.id),
            code: SHARED_STYLE_IN_USE_CODE,
            message: reason.message,
          })),
    logContext,
  });
}

/**
 * The stored documents' own answer to whether some styles are still used,
 * asked once the index has found none, and how the first use the caller may
 * open is named.
 */
export interface StillUsedCheck {
  /** Every stored document still referencing any of the ids, read past access. */
  uses(ids: readonly string[]): Promise<readonly StoredUse[]>;
  /** The title of the first of these the caller may open, if any. */
  firstReadable(uses: readonly StoredUse[]): Promise<string | undefined>;
}

/**
 * Remove unused shared styles: the one write that may remove one.
 *
 * Every check runs on what the server reads just before the write, never on
 * what the panel showed: each style must be stored, not defined in code and
 * not locked, the usage index must be whole, and no document may use it,
 * first by the index and then by the stored documents themselves. One
 * refusal refuses the whole request, so nothing is half removed.
 *
 * A write refused because the Single was saved meanwhile is made again on
 * what is stored then: the stored entries and the index are asked again, and
 * only these styles are taken out of the newest list. The stored documents
 * are walked again too: a page saved using a style between two attempts is
 * one the index may not have counted, which is what the walk is there for.
 */
export async function removeSharedStyles(
  req: Request,
  store: SharedStyleStore,
  usage: SharedStyleUsageSource,
  configClassIds: ReadonlySet<string>,
  stillUsed: StillUsedCheck
): Promise<Response> {
  const parsed = RemoveBody.safeParse(await jsonBody(req));
  if (!parsed.success) {
    throw invalidRequest(
      `Name between 1 and ${SHARED_STYLE_USAGE_IDS_MAX} shared styles to remove, as ids.`
    );
  }
  const ids = [
    ...new Set(parsed.data.ids),
  ] satisfies SharedStyleRemoveRequest["ids"];
  const gone = new Set(ids);
  await retryOnStale(
    () => store.read(),
    async read => {
      const classes = read.entries;
      const { reasons, removable } = storedRefusals(
        ids,
        classes,
        configClassIds
      );
      // Read just before the write, never taken from what the panel showed.
      reasons.push(...(await usageRefusals(removable, usage, "shared style")));
      if (reasons.length > 0) {
        throw removalRefusalOf(reasons, { classIds: ids });
      }
      // Only once the index found nothing: its refusals name every reason
      // cheaply, and this read walks every document the builder opens. An
      // index zero is not proof, since interleaved saves of one document can
      // drop a usage row; the refusal names only a document the caller may
      // open, and counts the rest.
      await refuseStoredUses(ids, stillUsed, "classIds");
      await store.write(
        classes.filter(
          entry => typeof entry.id !== "string" || !gone.has(entry.id)
        ),
        // Unmarked: only a lock change needs a route's mark.
        {},
        read
      );
    }
  );
  return respondMutation(
    ids.length === 1
      ? "The shared style was removed."
      : `${ids.length} shared styles were removed.`,
    { ids }
  );
}

/** The slice of the Direct API the store reads and writes the Single through. */
interface SharedStyleDirectApi {
  findSingle(args: { slug: string; overrideAccess: boolean }): Promise<unknown>;
  updateSingle(args: {
    slug: string;
    data: Record<string, unknown>;
    overrideAccess: boolean;
    context: Record<string, unknown>;
    user?: { id: string };
  }): Promise<unknown>;
}

/**
 * The stored class list of the RESOLVED site-style Single, read and written
 * past its own permission: the route's declared permission is what admits
 * the caller. Written as the caller, so the Single's guard judges the write.
 */
export function siteStyleClassStore(
  ctx: Pick<PluginRouteContext, "self" | "user">,
  nextly: SharedStyleDirectApi
): SharedStyleStore {
  const slug = ctx.self.singles[SITE_STYLE_SLUG] ?? SITE_STYLE_SLUG;
  return {
    read: async () => {
      const doc = await nextly.findSingle({ slug, overrideAccess: true });
      const rev = documentVersionOf(doc);
      const raw =
        doc !== null && typeof doc === "object"
          ? readStoredJson((doc as Record<string, unknown>).classes)
          : undefined;
      if (!Array.isArray(raw)) return { entries: [], rev };
      return {
        entries: raw.filter(
          (entry): entry is Record<string, unknown> =>
            entry !== null && typeof entry === "object" && !Array.isArray(entry)
        ),
        rev,
      };
    },
    write: async (classes, context, from) => {
      await nextly.updateSingle({
        slug,
        data: withVersionFrom({ classes }, from.rev),
        overrideAccess: true,
        context: { ...context },
        ...(ctx.user === null ? {} : { user: { id: ctx.user.id } }),
      });
    },
  };
}

/**
 * The documents of one collection the caller may read, as the where-used
 * list names them: the collection's title field by the entries route's rule,
 * and the rows read as the caller.
 */
export function namedDocumentsReader(
  ctx: Pick<PluginRouteContext, "caller" | "services">
): ReadNamedDocuments {
  return async (collection, ids) => {
    try {
      const record = await ctx.services.collections.getCollection(
        collection,
        {}
      );
      const title =
        record !== null && typeof record === "object"
          ? titleFieldIn(record)?.name
          : undefined;
      const page = await findAsCaller(ctx, {
        collection,
        where: { id: { in: [...ids] } },
        select: { id: true, ...(title === undefined ? {} : { [title]: true }) },
        limit: ids.length,
      });
      return page.items.flatMap(row => entryOf(row, title) ?? []);
    } catch (error) {
      // A collection the caller may not read, or one that is gone, names
      // nothing: its documents are counted as hidden.
      if (NextlyError.isForbidden(error) || NextlyError.isNotFound(error)) {
        return null;
      }
      throw error;
    }
  };
}

/**
 * A Single the caller may read, named by its label from the Singles registry,
 * which creates nothing; read through the Single API as the caller.
 */
export function namedSingleReader(
  ctx: Pick<PluginRouteContext, "caller" | "services">
): ReadNamedSingle {
  return async slug => {
    if (!(await singleReadableByCaller(ctx, slug))) return null;
    const listed = await ctx.services.singles.list({
      slugAllowlist: [slug],
      limit: 1,
    });
    const label = listed.data[0]?.label;
    return typeof label === "string" && label !== "" ? label : slug;
  };
}

/**
 * The slice of the Direct API the rescan reads stored documents through: a
 * list read for the rows, and the by-id and by-slug reads every other form is
 * read by.
 */
export interface RescanDirectApi
  extends Pick<ClassUsageDirectApi, "findByID" | "findSingle"> {
  find(args: {
    collection: string;
    where?: WhereFilter;
    select: Record<string, boolean>;
    sort: string;
    limit: number;
    page: number;
    depth: number;
    overrideAccess: boolean;
  }): Promise<{ items: unknown[]; meta: { hasNext: boolean } }>;
}

/** The top-level fields a row is read with: the id, and each path's first key. */
export function rescanSelect(
  paths: readonly string[]
): Record<string, boolean> {
  return Object.fromEntries([
    ["id", true],
    ...paths.map(path => [path.split(".")[0] ?? path, true]),
  ]);
}

/**
 * Every form a document may be stored in on a site with these languages:
 * each language and the working draft in each, or with none configured, the
 * one document and its draft. The draft is read whether or not a collection
 * keeps drafts, since the draft read answers nothing where none is surfaced.
 */
export function storedFormsOn(
  locales: readonly string[]
): StoredDocumentForm[] {
  return (locales.length > 0 ? locales : [""]).flatMap(locale => [
    { locale, variant: "published" as const },
    { locale, variant: "draft" as const },
  ]);
}

/** The form a list read answers: the default language, without the draft. */
const LISTED_FORM: StoredDocumentForm = { locale: "", variant: "published" };

/**
 * Whether `form` is the one a list read already answered, which a row's
 * other forms leave out rather than read again.
 */
export function isListedForm(form: StoredDocumentForm): boolean {
  return (
    form.locale === LISTED_FORM.locale && form.variant === LISTED_FORM.variant
  );
}

/**
 * The stored documents the builder opens, read as the system: the removal's
 * rescan must see a document the caller may not, since that document's
 * styling is lost all the same. Every form of each is read, in each of the
 * site's languages and as its working draft.
 */
export function storedDocumentsOf(
  ctx: Pick<SiteStyleRouteContext, "self" | "services"> & {
    readonly config: SiteStyleRouteContext["config"] & LocalizedConfig;
  },
  nextly: RescanDirectApi
): StoredDocuments {
  const formsOf = storedFormsReader(nextly);
  // Read per walk, as every reader of the site's languages reads them.
  const forms = () => storedFormsOn(siteLocales(ctx.config));
  return {
    collections: () => collectionsTheBuilderOpens(ctx),
    singles: () => singlesTheBuilderOpens(ctx),
    rowsAfter: async (type, after) => {
      const page = await nextly.find({
        collection: type.slug,
        // Always the first page of what is left past the cursor.
        ...(after === undefined
          ? {}
          : { where: { id: { greater_than: after } } }),
        select: rescanSelect(type.paths),
        sort: "id",
        limit: RESCAN_PAGE_SIZE,
        page: 1,
        depth: 0,
        overrideAccess: true,
      });
      return { items: page.items, hasNext: page.meta.hasNext };
    },
    // The listed form is the row already in hand, so it is not read again.
    rowForms: (type, id) =>
      formsOf(
        { scope: "collection", entity: type.slug, entityKey: id },
        forms().filter(form => !isListedForm(form))
      ),
    singleForms: type =>
      formsOf({ scope: "single", entity: type.slug, entityKey: "" }, forms()),
  };
}

/**
 * Every stored document still referencing any of the shared styles, walked
 * as the class index records, so the two agree. The one walk both the remove
 * route and the site style's own write (`site-style-removal-lock`) ask.
 */
export function storedSharedStyleUses(
  documents: StoredDocuments
): (ids: readonly string[]) => Promise<StoredUse[]> {
  return ids =>
    storedUsesOf(ids, documents, stored => classUsageOf(stored).ids);
}

/**
 * The title of the first stored use the caller may open: collection rows read
 * as the caller, a batch at a time, then a Single the caller may read, by its
 * label. `undefined` when the caller may open none of them.
 */
export async function firstReadableTitle(
  uses: readonly StoredUse[],
  readNamed: ReadNamedDocuments,
  mayReadSingle: (slug: string) => Promise<boolean>
): Promise<string | undefined> {
  return (
    (await firstReadableRow(uses, readNamed)) ??
    (await firstReadableSingle(uses, mayReadSingle))
  );
}

/** The collection rows among the uses, their ids grouped by collection. */
function rowsByCollection(uses: readonly StoredUse[]): Map<string, string[]> {
  const rows = new Map<string, string[]>();
  for (const use of uses.filter(use => use.kind === "collection")) {
    rows.set(use.slug, [...(rows.get(use.slug) ?? []), use.id]);
  }
  return rows;
}

/** The title of the first collection row the caller may read, as the caller. */
async function firstReadableRow(
  uses: readonly StoredUse[],
  readNamed: ReadNamedDocuments
): Promise<string | undefined> {
  for (const [collection, ids] of rowsByCollection(uses)) {
    for (const batch of chunked(ids, ID_BATCH_SIZE)) {
      const first = (await readNamed(collection, batch))?.[0];
      if (first !== undefined) return first.title;
    }
  }
  return undefined;
}

/** The label of the first Single among the uses the caller may read. */
async function firstReadableSingle(
  uses: readonly StoredUse[],
  mayReadSingle: (slug: string) => Promise<boolean>
): Promise<string | undefined> {
  for (const use of uses.filter(use => use.kind === "single")) {
    if (await mayReadSingle(use.slug)) return use.label ?? use.slug;
  }
  return undefined;
}

/**
 * Whether this caller may read shared styles' usage: Design's read of the
 * site style, or the right to lock shared styles, which the Lock control
 * needs the usage read's `mayLock` to offer. One decision, asked through
 * `ctx.caller.can` before anything is read, as the site-style route asks.
 */
export async function mayReadSharedStyleUsage(
  ctx: Pick<PluginRouteContext, "caller" | "self">
): Promise<boolean> {
  const { caller } = ctx;
  // The routes are authenticated, so the dispatcher refuses an anonymous
  // caller first; `null` must still never read as allowed.
  if (caller === null) return false;
  const style = ctx.self.singles[SITE_STYLE_SLUG] ?? SITE_STYLE_SLUG;
  if (await caller.can("read", style)) return true;
  return caller.can(LOCK_SHARED_STYLES.action, LOCK_SHARED_STYLES.resource);
}

/**
 * Whether this caller may ask for the pages to be counted now: whoever may
 * change Design, the same people who may remove a style, which is what a
 * whole count is for. The route declares the same permission, so this is
 * the panel's hint and the route is the decision.
 */
export async function mayCountSharedStyleUsage(
  ctx: Pick<PluginRouteContext, "caller" | "self">
): Promise<boolean> {
  if (ctx.caller === null) return false;
  const style = ctx.self.singles[SITE_STYLE_SLUG] ?? SITE_STYLE_SLUG;
  return ctx.caller.can("update", style);
}

/**
 * The most the count route spends starting the usage backfill: long enough
 * to count a small site in one go, and well inside a serverless request's
 * limit. A site larger than one pass is counted further on the next ask, or
 * by a scheduler; the backfill's progress is durable either way.
 */
export const SHARED_STYLE_COUNT_MS = 10_000;

/**
 * Count the site's pages now: run the usage backfill, this plugin's own
 * sweep, for at most {@link SHARED_STYLE_COUNT_MS}, then answer the index's
 * health as it stands after. On a site no scheduler drains, this is the only
 * way the counts ever become exact.
 */
export async function countSharedStyleUsage(
  jobs: Pick<PluginRouteContext["services"]["jobs"], "runSweepNow">,
  usage: Pick<SharedStyleUsageSource, "health">
): Promise<Response> {
  const { ran } = await jobs.runSweepNow(USAGE_BACKFILL_JOB, {
    maxDurationMs: SHARED_STYLE_COUNT_MS,
  });
  // Read after the run, so the answer says how far this run got.
  const health = await usage.health();
  const item: SharedStylesCountResponse = {
    ran,
    whole: indexIsWhole(health),
    counting: indexStillCounting(health),
  };
  return respondMutation(
    item.whole
      ? "Every page has been counted."
      : "Some pages are still to count.",
    item
  );
}

/** Refuse a caller who may not read shared styles' usage, before any read. */
async function admitUsageReader(
  ctx: Pick<PluginRouteContext, "caller" | "self">
): Promise<void> {
  if (!(await mayReadSharedStyleUsage(ctx))) {
    throw NextlyError.forbidden({
      logContext: { reason: "shared-style-usage-needs-read-or-lock" },
    });
  }
}

/** What the routes are built from, per request. */
export interface SharedStyleRouteSetup {
  /** The ids of the classes the site's code supplies. */
  readonly configClassIds: ReadonlySet<string>;
  /** The usage index for this request. */
  readonly usage: (ctx: PluginRouteContext) => SharedStyleUsageSource;
}

/** The read and update permissions on the RESOLVED site-style Single. */
export function siteStylePermission(
  action: "read" | "update"
): (scope: PluginRoutePermissionScope) => string {
  return ({ single }) => single(SITE_STYLE_SLUG, action);
}

/**
 * The five shared-style routes. Lock, count and remove declare their permission; the
 * two usage reads are authenticated and decide in the handler, since one
 * permission cannot say "Design's read, or the lock".
 */
export function sharedStyleRoutes(setup: SharedStyleRouteSetup): {
  method: "GET" | "POST";
  path: string;
  requiredPermission?: string | ((scope: PluginRoutePermissionScope) => string);
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
}[] {
  return [
    {
      method: "POST",
      path: SHARED_STYLE_LOCK_ROUTE_PATH,
      // The lock permission alone: toggling a lock changes no design.
      requiredPermission: LOCK_SHARED_STYLES_PERMISSION,
      handler: async (req, ctx) =>
        lockSharedStyle(
          req,
          siteStyleClassStore(ctx, await getCachedNextly()),
          setup.configClassIds
        ),
    },
    {
      method: "GET",
      path: SHARED_STYLE_USAGE_ROUTE_PATH,
      handler: async (req, ctx) => {
        await admitUsageReader(ctx);
        return respondDoc(
          await readSharedStyleUsage(req, ctx, setup.usage(ctx))
        );
      },
    },
    {
      method: "GET",
      path: SHARED_STYLE_WHERE_USED_ROUTE_PATH,
      handler: async (req, ctx) => {
        await admitUsageReader(ctx);
        return readSharedStyleUses(
          req,
          setup.usage(ctx),
          namedDocumentsReader(ctx),
          namedSingleReader(ctx)
        );
      },
    },
    {
      method: "POST",
      path: SHARED_STYLE_COUNT_ROUTE_PATH,
      // Design's update: whoever a whole count lets remove a style.
      requiredPermission: siteStylePermission("update"),
      handler: async (_req, ctx) =>
        countSharedStyleUsage(ctx.services.jobs, setup.usage(ctx)),
    },
    {
      method: "POST",
      path: SHARED_STYLE_REMOVE_ROUTE_PATH,
      requiredPermission: siteStylePermission("update"),
      handler: async (req, ctx) => {
        const nextly = await getCachedNextly();
        const readNamed = namedDocumentsReader(ctx);
        return removeSharedStyles(
          req,
          siteStyleClassStore(ctx, nextly),
          setup.usage(ctx),
          setup.configClassIds,
          {
            uses: storedSharedStyleUses(storedDocumentsOf(ctx, nextly)),
            firstReadable: uses =>
              firstReadableTitle(
                uses,
                readNamed,
                async slug => (await ctx.caller?.can("read", slug)) ?? false
              ),
          }
        );
      },
    },
  ];
}
