/**
 * Dashboard Service
 *
 * Aggregates content-centric statistics, recent entries across collections,
 * and project-wide metrics for the admin dashboard.
 *
 * Anything describing CONTENT goes through the ordinary access-controlled path
 * — `nextly.find` for the recent-entries feed, `nextly.count` for the
 * per-collection totals — because a number computed beside the access layer
 * discloses exactly what the row read withholds. The adapter is used directly
 * only for the installation-wide admin metrics (`media`, `users`, `roles`,
 * `permissions`, active API keys), and for the two `activity_log` aggregates,
 * whose scoping is applied to the query itself. Each admin metric is counted
 * only for a caller who may read its resource, and left out otherwise; see
 * `admin-counts`.
 *
 * @module services/dashboard/dashboard-service
 * @since 1.0.0
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SqlParam } from "@nextlyhq/adapter-drizzle/types";

import type { RequestActorType } from "../../auth/request-actor";
import { container } from "../../di/container";
import { requireNextly } from "../../direct-api/nextly";
import type { CountArgs, FindArgs } from "../../direct-api/types";
import { COMMON_TITLE_FIELDS } from "../../domains/collections/entry-title";
import {
  keptOffDashboard,
  type DashboardContentKind,
} from "../../domains/widgets/kept-off-dashboard";
import {
  effectiveWidgetLimit,
  MAX_WIDGET_LIMIT,
} from "../../domains/widgets/query-limits";
import {
  createDisabledSlugs,
  createVerdict,
  updateVerdict,
} from "../../domains/widgets/reader-content";
import type { ActivityEvent } from "../../domains/widgets/result";
import { entryHeading } from "../../lib/entry-heading";
import { BaseService } from "../base-service";
import type { Logger } from "../shared";

import type {
  ActivityKeptOffCollections,
  ActivityLogService,
  ActivitySingles,
  RecentActivityCount,
  RecentEdit,
} from "./activity-log-service";
import type { AdminCount, ApiKeyCountScope } from "./admin-counts";
import {
  filterByResource,
  someResources,
  type ReadableResources,
  type ReadCaller,
} from "./readable-resources";

/** Content statistics for the hero stats row. */
export interface ContentStats {
  totalEntries: number;
  /** Absent for a caller who may not read media. */
  totalMedia?: number;
  contentTypes: number;
  recentChanges24h: number;
  /**
   * Present, and true, when counting stopped at its bound: at least `recentChanges24h` changes,
   * drawn `N+`. Absent means the figure is whole.
   */
  recentChanges24hAtLeast?: true;
}

/** Draft vs Published breakdown. */
export interface ContentStatus {
  published: number;
  draft: number;
}

/** Per-collection entry count for collection quick-links. */
export interface CollectionCount {
  slug: string;
  label: string;
  group: string | null;
  count: number;
}

/**
 * Full dashboard stats response.
 *
 * The installation-wide counts are optional: each is present only for a
 * caller who may read that resource, and absent -- not zero -- for anyone
 * else, so the response does not change with rows the caller cannot see.
 */
export interface DashboardStatsResponse {
  content: ContentStats;
  status: ContentStatus;
  collectionCounts: CollectionCount[];
  users?: number;
  roles?: number;
  permissions?: number;
  fieldGroups?: number;
  singles: number;
  apiKeys?: number;
}

/**
 * One collection's entries as this caller may read them: its total, and how
 * many are published and how many are drafts.
 *
 * The per-collection reading `/stats` derives its counts and its overall
 * breakdown from. Its drafts are counted by the one rule the Content table's
 * Drafts column counts by (the list's Draft filter), so the two cannot come to
 * disagree about what a draft is. A collection without the Draft/Published
 * lifecycle has no drafts: every entry the caller may read is published.
 */
interface CollectionContent extends CollectionCount {
  published: number;
  draft: number;
}

/**
 * One row of the dashboard's Content table: a collection or a Single this
 * caller may see, flat, as `system:content` answers it.
 *
 * The counts and the create decision are a collection's alone: a Single has
 * one document, so its row carries none of them. When it was last updated,
 * who did it and what they did come from ONE source: the activity trail's
 * latest change of the subject where the trail holds one, else the row's own
 * data, which names nobody (`updateFields`).
 */
export interface ContentTableRow {
  kind: "collection" | "single";
  slug: string;
  label: string;
  group: string | null;
  /** The entries this caller may read; a collection's only. */
  count?: number;
  /**
   * The drafts this caller may read, by the list's Draft filter; `null` for a
   * collection without the Draft/Published lifecycle, which has none to count.
   * A collection's only.
   */
  draft?: number | null;
  /** Whether this caller may create an entry here; a collection's only. */
  canCreate?: boolean;
  /**
   * Whether this caller may update the Single, by the decision a real write
   * makes; a Single's only. A reader who may read it and not update it opens
   * it read-only.
   */
  canUpdate?: boolean;
  /**
   * When it was last updated: the trail's latest change of it, or without
   * one, a collection's newest entry this caller may read or a Single's
   * document. Absent only while there is no entry or document to date.
   */
  updatedAt?: string;
  /** Who made that change, as the trail records them; absent without one. */
  userId?: string;
  userName?: string | null;
  actorType?: RequestActorType;
  identityErasedAt?: string | null;
  /** What that change did, where the trail names it: saved, published and so on. */
  event?: ActivityEvent;
}

/** The Content table's rows, and how many rows its read matched in all. */
export interface ContentTable {
  /** The rows drawn, in the table's order. */
  rows: ContentTableRow[];
  /**
   * How many rows the table's read matched for this caller: every collection
   * AND every Single they may see on the dashboard, counted from the registry
   * without reading a single entry. The rows drawn are the first page of
   * these, so this is the list answer's `total`, as every list answer's is.
   * Not only the collections: a count of some of the rows beside the rows would
   * misstate how many more there are.
   */
  total: number;
  /** How `total` divides into collections and Singles, from the same registry reads. */
  byKind: { collection: number; single: number };
}

/**
 * The collection list's Draft filter, as the admin's entry list asks it: every
 * entry (`status: "all"`), narrowed by `where` to those whose `status` is
 * `draft` (the list's `buildEntryWhereFilter`). The dashboard counts its drafts
 * by it, so a Drafts figure and the list its link opens are the same read.
 *
 * Not `status: "draft"`, which is every state the workflow does not publish
 * and, on a localized collection, is also applied to each language's own
 * status: the two can disagree, and the link would then open a list holding
 * another number.
 */
const LIST_DRAFT_FILTER = {
  status: "all",
  where: { status: { equals: "draft" } },
} as const satisfies Pick<CountArgs<string>, "status" | "where">;

/** Which entries of a collection a count reads. */
type EntryCount = "all" | "published" | "draft";

/** A collection or a Single the Content table may draw, before anything is counted. */
type ContentSubject =
  | { kind: "collection"; slug: string; label: string; info: CollectionInfo }
  | { kind: "single"; slug: string; label: string; tableName?: string };

/** A collection's newest entry, or a Single's document: its id, and when it was last updated. */
interface OwnUpdate {
  id: string;
  updatedAt?: string;
}

/**
 * A subject with its own last update, read before the page is chosen: a
 * collection's newest entry this caller may read, or a Single's document;
 * `own` is undefined while there is none.
 */
type DatedSubject = ContentSubject & { own: OwnUpdate | undefined };

/** What every read of the trail for the Content table is narrowed by. */
interface TrailSubjects {
  scope: ReadableResources;
  caller: ReadCaller;
  singles: ActivitySingles;
  keptOffCollections: ActivityKeptOffCollections;
  /** One collection's saves alone, never a Single's. */
  collection?: string;
  /** One Single's saves alone, never a collection's. */
  single?: string;
}

/** What building a drawn row needs beyond the row itself, read once for the whole page. */
interface RowContext {
  caller: ReadCaller;
  trail: TrailSubjects;
  /** Whether the trail's window reached the trail's end. */
  complete: boolean;
  /** Each subject's latest save in the window, by `subjectKey`. */
  saved: ReadonlyMap<string, RecentEdit>;
  mayCreate: (slug: string) => Promise<boolean>;
  /** Whether the caller may update a Single, failing closed (`updateDecision`). */
  mayUpdate: (slug: string) => Promise<boolean>;
}

/**
 * How many subjects one load reads the own last update of before it chooses
 * the page; see `rankingOrder` for which. Never fewer than a page holds
 * (`effectiveWidgetLimit` clamps every page to `MAX_WIDGET_LIMIT`), so a page
 * is always drawn from subjects that were read.
 */
const RANKING_READS = MAX_WIDGET_LIMIT;

/**
 * How many subjects are read at once, for the ranking and again for the rows
 * drawn. Each read is a query, and a collection's is an access-enforced read,
 * so a load takes at most this many subjects' connections from the pool at a
 * time, however many subjects it ranks or draws: a drawn collection's four
 * reads (its total, its drafts, its create decision and its latest change)
 * run together, and the next row's start only as a row finishes.
 */
const READ_CONCURRENCY = 4;

/**
 * `map` over `items`, at most `concurrency` of them at once, each answer at its
 * item's place: the next item starts as one finishes.
 */
async function mapBounded<T, R>(
  items: readonly T[],
  concurrency: number,
  map: (item: T) => Promise<R>
): Promise<R[]> {
  const answers: R[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      answers[index] = await map(items[index]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker)
  );
  return answers;
}

/**
 * The order the subjects' own last updates are read in, which decides which
 * are read when there are more than `RANKING_READS`: first every subject the
 * trail's window holds a save of, then the rest by label. The window holds at
 * most `MAX_WIDGET_LIMIT` documents, so it names no more subjects than the
 * bound and each one it names is read; the rest, past the bound, are left
 * unread and never make the page. A subject saved recently is therefore
 * ranked by its own date whatever its name, and a load reads at most
 * `RANKING_READS` subjects however large the install.
 */
function rankingOrder(
  subjects: readonly ContentSubject[],
  saved: ReadonlyMap<string, RecentEdit>
): ContentSubject[] {
  const byName = [...subjects].sort(byLabel);
  const named = (subject: ContentSubject) =>
    saved.has(subjectKey(subject.kind, subject.slug));
  return [
    ...byName.filter(named),
    ...byName.filter(subject => !named(subject)),
  ];
}

/** The trail narrowed to `subject`'s saves alone. */
function narrowedTo(
  trail: TrailSubjects,
  subject: Pick<ContentSubject, "kind" | "slug">
): TrailSubjects {
  return subject.kind === "single"
    ? { ...trail, single: subject.slug }
    : { ...trail, collection: subject.slug };
}

/**
 * A document's id as a trail row names it, a string whatever the column's
 * type; `undefined` for anything that is no id.
 */
function documentIdOf(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : undefined;
}

/** A document's id and, when it is a readable instant, when it was last updated. */
function ownUpdate(id: string, updatedAt: unknown): OwnUpdate {
  const at = isoInstant(updatedAt);
  return at === undefined ? { id } : { id, updatedAt: at };
}

/** A Single's stored row as the document it holds, or `undefined` without one. */
function storedDocument(
  row: { id?: unknown; updated_at?: unknown } | null | undefined
): OwnUpdate | undefined {
  const id = documentIdOf(row?.id);
  return id === undefined ? undefined : ownUpdate(id, row?.updated_at);
}

/**
 * A Single's row: its Updated and who made it, from its latest change
 * (`updateFields`), and whether the caller may update it.
 */
function singleRow(
  subject: Extract<DatedSubject, { kind: "single" }>,
  change: RecentEdit | undefined,
  canUpdate: boolean
): ContentTableRow {
  return {
    kind: "single",
    slug: subject.slug,
    label: subject.label,
    group: null,
    canUpdate,
    ...updateFields(subject.own, change),
  };
}

/**
 * How much older than a row's own last update the trail's latest change of it
 * may be and still be the change that made it: under one second.
 *
 * One write stamps the row and files its trail row a few milliseconds apart,
 * and SQLite and MySQL at its default precision keep each instant to the
 * second, so the two stored instants of one write can differ by up to a
 * second either way. A change older by a whole second or more is an earlier
 * write, and the row was changed since by something the trail did not record.
 */
const SAME_WRITE_MS = 1000;

/**
 * Whether `change` is older than the row's own last update by more than one
 * write's two instants can differ (`SAME_WRITE_MS`): a trail that missed the
 * row's latest write.
 */
function staleChange(changeAt: string, ownAt: string | undefined): boolean {
  if (ownAt === undefined) return false;
  return Date.parse(ownAt) - Date.parse(changeAt) >= SAME_WRITE_MS;
}

/**
 * A row's Updated and who made it, both from ONE source, so the instant and
 * the name always describe the same change. Where the trail's latest change
 * of the subject (`change`) is the row's latest write, its instant, its actor
 * and what it did. Where the trail holds none, or only one older than the
 * row's own last update (`staleChange`), the row's own last update and no
 * name, since nothing says who made that write. Nothing for a row with no
 * entry or document to date.
 *
 * Never a mix: the row's own instant beside the name on an earlier save would
 * credit that save's author with a later change they did not make, such as a
 * publish by someone else, which also moves the row's own instant. And never
 * the older change's instant on a row ranked by its newer own date, which
 * would show a row sorted as the newest with an older time than those below.
 */
function updateFields(
  own: OwnUpdate | undefined,
  change: RecentEdit | undefined
): Pick<
  ContentTableRow,
  | "updatedAt"
  | "userId"
  | "userName"
  | "actorType"
  | "identityErasedAt"
  | "event"
> {
  if (own === undefined) return {};
  const at = change === undefined ? undefined : isoInstant(change.createdAt);
  if (
    change === undefined ||
    at === undefined ||
    staleChange(at, own.updatedAt)
  ) {
    return own.updatedAt === undefined ? {} : { updatedAt: own.updatedAt };
  }
  return { updatedAt: at, ...saverFields(change) };
}

/** A subject's key in the trail's answer: a collection and a Single may share a slug. */
function subjectKey(kind: "collection" | "single", slug: string): string {
  return `${kind}:${slug}`;
}

/** The key of the document a save names: a row stating no kind is a collection's. */
function saveKey(save: RecentEdit): string {
  return subjectKey(
    save.subjectKind === "single" ? "single" : "collection",
    save.collection
  );
}

/**
 * Each subject's latest save among `saves`, which are newest first: the first
 * save naming it is its latest.
 */
function latestSaveOf(saves: readonly RecentEdit[]): Map<string, RecentEdit> {
  const latest = new Map<string, RecentEdit>();
  for (const save of saves) {
    const key = saveKey(save);
    if (!latest.has(key)) latest.set(key, save);
  }
  return latest;
}

/**
 * Whether the caller may update a Single: the decision a real write makes
 * (`updateVerdict`), the one gate the Single's editor is judged by too. Fails
 * closed: a decision that throws is no, so a row never offers Edit onto a
 * refusal.
 */
function updateDecision(
  caller: ReadCaller
): (slug: string) => Promise<boolean> {
  const verdict = updateVerdict(caller);
  return slug => verdict(slug).catch(() => false);
}

/** Who made `save` and what it did, as a row of the table carries them. */
function saverFields(
  save: RecentEdit
): Pick<
  ContentTableRow,
  "userId" | "userName" | "actorType" | "identityErasedAt" | "event"
> {
  return {
    userId: save.userId,
    userName: save.userName,
    actorType: save.actorType,
    identityErasedAt: save.identityErasedAt,
    ...(save.event === undefined ? {} : { event: save.event }),
  };
}

/**
 * A stored instant as an ISO string, or `undefined` for anything that is not
 * one: a driver answers a timestamp column as a `Date` on one dialect and a
 * string on another.
 */
function isoInstant(value: unknown): string | undefined {
  const date =
    value instanceof Date
      ? value
      : typeof value === "string" && value !== ""
        ? new Date(value)
        : undefined;
  return date === undefined || Number.isNaN(date.getTime())
    ? undefined
    : date.toISOString();
}

/** Ascending by label, then slug, for subjects with nothing to date them. */
function byLabel(
  a: { label: string; slug: string },
  b: { label: string; slug: string }
): number {
  return a.label.localeCompare(b.label) || (a.slug < b.slug ? -1 : 1);
}

/**
 * The subjects with a known last update, newest first, then the rest by
 * label. Every instant compared is an ISO string (`isoInstant`), so comparing
 * the strings compares the instants.
 */
function byLastUpdate<T extends { slug: string; label: string }>(
  subjects: readonly T[],
  updatedAt: (subject: T) => string | undefined
): T[] {
  return [...subjects].sort((a, b) => {
    const at = updatedAt(a);
    const bt = updatedAt(b);
    if (at !== undefined && bt !== undefined && at !== bt) {
      return at < bt ? 1 : -1;
    }
    if (at !== undefined && bt === undefined) return -1;
    if (at === undefined && bt !== undefined) return 1;
    return byLabel(a, b);
  });
}

/**
 * The subjects in the table's order, each ranked by its OWN last update: the
 * newest first, then those with nothing to date them by label, and the
 * collections holding no entries this caller may read after all of them, since
 * an empty collection is the one row with nothing to open. A collection whose
 * newest entry the reader may read holds at least that entry, so having no
 * newest entry is having none to read.
 */
function inTableOrder(subjects: readonly DatedSubject[]): DatedSubject[] {
  const ordered = byLastUpdate(subjects, subject => subject.own?.updatedAt);
  const empty = (subject: DatedSubject) =>
    subject.kind === "collection" && subject.own === undefined;
  return [
    ...ordered.filter(subject => !empty(subject)),
    ...ordered.filter(empty),
  ];
}

/**
 * The overall draft/published breakdown, DERIVED from the per-collection rows
 * rather than read beside them, so the summary always equals the sum of what the
 * Content card shows.
 */
function contentStatusOf(content: readonly CollectionContent[]): ContentStatus {
  return content.reduce(
    (sum, row) => ({
      published: sum.published + row.published,
      draft: sum.draft + row.draft,
    }),
    { published: 0, draft: 0 }
  );
}

/** A recently edited entry across any collection. */
export interface RecentEntry {
  id: string;
  title: string;
  collectionSlug: string;
  collectionLabel: string;
  status: "published" | "draft" | "none";
  updatedAt: string;
}

/** Response for the recent entries endpoint. */
export interface RecentEntriesResponse {
  entries: RecentEntry[];
}

/** Single stat item for the project statistics grid. */
export interface ProjectStat {
  key: string;
  label: string;
  value: number;
}

/** Response for the project stats endpoint. */
export interface ProjectStatsResponse {
  stats: ProjectStat[];
}

/** `{ [key]: value }` when the value was counted, and nothing when it was not. */
function present<K extends string>(
  key: K,
  value: number | undefined
): Partial<Record<K, number>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, number>);
}

/** Maximum number of collections to query for recent entries. */
const MAX_COLLECTIONS_FOR_RECENT = 20;

/**
 * The collections or Singles one registry read left out as kept off the dashboard, and whether
 * that read completed. Until it has, the set is not a snapshot of anything: an empty one would mean "nothing
 * is hidden" when the truth is "the hidden ones are unknown".
 */
interface KeptOffRead {
  slugs: Set<string>;
  complete: boolean;
}

/**
 * Whether a registry record is kept off the dashboard, noting its slug in `keptOff` when it is.
 */
function leftOut(
  kind: DashboardContentKind,
  record: { slug: string; source?: unknown; admin?: unknown },
  keptOff: Set<string> | undefined
): boolean {
  if (!keptOffDashboard(kind, record)) return false;
  keptOff?.add(record.slug);
  return true;
}

export class DashboardService extends BaseService {
  constructor(adapter: DrizzleAdapter, logger: Logger) {
    super(adapter, logger);
  }

  /**
   * Get aggregated dashboard statistics.
   *
   * Runs all count queries in parallel for fast response. The per-collection
   * totals go through the access-controlled count; see
   * {@link countReadableEntries} for why they cannot be a bare `COUNT(*)`.
   */
  async getStats(options: {
    scope?: ReadableResources;
    /**
     * Who is asking. REQUIRED, not defaulted, for the reason
     * {@link getRecentEntries} states: the per-collection totals are read with
     * access ENFORCED, so a caller-less call would have to read with
     * `user: undefined`, and the only safe meaning of that is zero. Making it a
     * type error forecloses the shape rather than leaving a runtime guard to
     * catch it.
     */
    caller: ReadCaller;
    /**
     * The installation-wide counts this caller may be given, as
     * `readableAdminCounts` decides. Omitted means none, for the same reason
     * an omitted scope means nothing: the default must be the refusal.
     */
    counts?: ReadonlySet<AdminCount>;
    /**
     * Whose API keys the key count covers, as `apiKeyCountScope` decides.
     * Omitted, the key count is left out: whose keys a caller may count is
     * not something to assume.
     */
    apiKeysOf?: ApiKeyCountScope;
  }): Promise<DashboardStatsResponse> {
    const counts = options.counts ?? new Set<AdminCount>();
    const apiKeysOf = options.apiKeysOf;
    // An omitted scope denies rather than allows. A caller that forgets to
    // pass one gets an empty dashboard, which is visible and reportable; the
    // old default returned everything, which was not.
    const scope = options.scope ?? someResources([]);
    // The collections and Singles the reads below leave out as kept off the dashboard, so the
    // activity figure leaves out the same ones from the same reads rather than counting them by
    // its own rule. Kept apart by kind: the trail files both under one `collection` column, and a
    // hidden Single sharing a visible collection's slug must not remove that collection's
    // activity, nor the other way round.
    const keptOffCollections: KeptOffRead = {
      slugs: new Set(),
      complete: false,
    };
    const keptOffSingles: KeptOffRead = { slugs: new Set(), complete: false };
    const collections = await this.getRegisteredCollections(
      scope,
      keptOffCollections
    );
    const singles = await this.getRegisteredSingles(scope, keptOffSingles);

    // Each collection's total and its published/draft split, read once: the
    // per-collection counts and the overall breakdown below are both derived
    // from these rows rather than read beside them.
    const content = await this.getCollectionContent(
      collections,
      options.caller
    );
    const collectionCounts = content.map(
      ({ slug, label, group, count }): CollectionCount => ({
        slug,
        label,
        group,
        count,
      })
    );

    // A count the caller may not be given is not run at all, rather than run
    // and dropped: the decision is the precondition, and a query that never
    // runs cannot leak through its failure or its timing.
    const ifAllowed = (
      count: AdminCount,
      read: () => Promise<number>
    ): Promise<number | undefined> =>
      counts.has(count) ? read() : Promise.resolve(undefined);

    const [
      mediaCount,
      recentChanges,
      userCount,
      roleCount,
      permissionCount,
      componentCount,
      apiKeyCount,
      statusBreakdown,
    ] = await Promise.all([
      ifAllowed("media", () => this.countTable("media")),
      this.countRecentChangesOutside(scope, options.caller, {
        collection: keptOffCollections,
        single: keptOffSingles,
      }),
      ifAllowed("users", () => this.countTable("users")),
      ifAllowed("roles", () => this.countTable("roles")),
      ifAllowed("permissions", () => this.countTable("permissions")),
      ifAllowed("fieldGroups", () =>
        this.countRegistryItems("fieldGroupRegistryService")
      ),
      apiKeysOf === undefined
        ? Promise.resolve(undefined)
        : ifAllowed("apiKeys", () => this.countActiveApiKeys(apiKeysOf)),
      Promise.resolve(contentStatusOf(content)),
    ]);

    const totalEntries = collectionCounts.reduce((sum, c) => sum + c.count, 0);

    // A refused count is left out of the object, not set to `undefined` on
    // it: JSON drops an undefined property anyway, but a caller of this
    // method reads the object itself, and `"users" in stats` must agree with
    // what the wire says.
    return {
      content: {
        totalEntries,
        ...present("totalMedia", mediaCount),
        contentTypes: collections.length,
        recentChanges24h: recentChanges.count,
        ...(recentChanges.atLeast
          ? { recentChanges24hAtLeast: true as const }
          : {}),
      },
      status: statusBreakdown,
      collectionCounts,
      ...present("users", userCount),
      ...present("roles", roleCount),
      ...present("permissions", permissionCount),
      ...present("fieldGroups", componentCount),
      singles: singles.length,
      ...present("apiKeys", apiKeyCount),
    };
  }

  /**
   * Get recently modified entries across all collections.
   *
   * Queries each registered collection for entries sorted by `updated_at DESC`,
   * merges results, and returns the top N entries. Capped at 20 collections
   * to prevent excessive DB queries on large installations.
   *
   * @param limit - Maximum number of entries to return (default: 5, max: 20)
   * @param scope - What the caller may read. Defaults to nothing rather than
   *   everything -- see {@link getStats}.
   * @param caller - Who is asking. REQUIRED, not defaulted: there is exactly
   *   one production caller (the REST handler, via `readCaller`), and a
   *   future handler that forgets to build one must fail to compile rather
   *   than silently return HTTP 200 with an empty, unauthenticated-looking
   *   feed. Reading with `user: undefined` and `overrideAccess: false` is the
   *   shape most likely to be mishandled downstream, so the type system
   *   forecloses it instead of a runtime guard trying to catch it.
   */
  async getRecentEntries(
    limit: number = 5,
    scope: ReadableResources = someResources([]),
    caller: ReadCaller
  ): Promise<RecentEntriesResponse> {
    const clampedLimit = Math.min(Math.max(limit, 1), 20);
    const collections = await this.getRegisteredCollections(scope);

    let collectionsToQuery = collections;
    if (collections.length > MAX_COLLECTIONS_FOR_RECENT) {
      this.logger.warn(
        `Dashboard: ${collections.length} collections registered, ` +
          `querying only the first ${MAX_COLLECTIONS_FOR_RECENT} for recent entries`
      );
      collectionsToQuery = collections.slice(0, MAX_COLLECTIONS_FOR_RECENT);
    }

    const entryPromises = collectionsToQuery.map(coll =>
      this.getRecentFromCollection(coll, clampedLimit, caller)
    );
    const results = await Promise.all(entryPromises);

    const allEntries = results
      .flat()
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )
      .slice(0, clampedLimit);

    return { entries: allEntries };
  }

  /**
   * Get project-wide statistics for the stats grid.
   *
   * Returns an array of stat items for display in the 2×4 grid widget.
   * Reuses the same data sources as `getStats()`.
   */
  async getProjectStats(options: {
    scope?: ReadableResources;
    caller: ReadCaller;
    counts?: ReadonlySet<AdminCount>;
  }): Promise<ProjectStatsResponse> {
    const dashStats = await this.getStats(options);

    // A count `getStats` left out is left out here too, rather than shown as 0.
    const stats: Array<{ key: string; label: string; value?: number }> = [
      {
        key: "entries",
        label: "Entries",
        value: dashStats.content.totalEntries,
      },
      {
        key: "media",
        label: "Media Assets",
        value: dashStats.content.totalMedia,
      },
      {
        key: "contentTypes",
        label: "Content Types",
        value: dashStats.content.contentTypes,
      },
      {
        key: "fieldGroups",
        label: "Field Groups",
        value: dashStats.fieldGroups,
      },
      { key: "singles", label: "Singles", value: dashStats.singles },
      { key: "users", label: "Users", value: dashStats.users },
      { key: "apiKeys", label: "API Keys", value: dashStats.apiKeys },
      { key: "locales", label: "Locales", value: 1 }, // Placeholder until i18n
    ];
    return {
      stats: stats.filter(
        (stat): stat is ProjectStat => stat.value !== undefined
      ),
    };
  }

  private async getRegisteredCollections(
    scope: ReadableResources,
    /** Collects the slugs left out as kept off the dashboard, for the figures read elsewhere. */
    keptOff?: KeptOffRead
  ): Promise<CollectionInfo[]> {
    try {
      const registryService = container.get<{
        getAllCollections: () => Promise<
          Array<{
            slug: string;
            tableName: string;
            labels: { singular: string; plural: string };
            admin?: { useAsTitle?: string; group?: string; hidden?: boolean };
            /** Who defines it, read with `admin` by the kept-off rule. */
            source?: string;
            /**
             * The Draft/Published lifecycle toggle. This is a top-level
             * column on `dynamic_collections`, entirely separate from
             * `fields` (the author's own field configs) -- and while the
             * lifecycle is on, a user field literally named `status` is
             * REJECTED at config validation as a reserved name (it would
             * collide with the synthesized lifecycle column). So a lifecycle
             * collection's `fields` array can never contain a `status`
             * entry: scanning it for one always answers false, for exactly
             * the collections this flag exists to identify.
             */
            status?: boolean;
          }>
        >;
      }>("collectionRegistryService");

      // A collection kept off the dashboard is neither listed nor counted here, for any caller,
      // a super-admin included; see `keptOffDashboard`.
      const collections = (await registryService.getAllCollections()).filter(
        c => !leftOut("collection", c, keptOff?.slugs)
      );
      if (keptOff) keptOff.complete = true;
      const mapped = collections.map(c => ({
        slug: c.slug,
        tableName: c.tableName,
        label: c.labels?.plural ?? c.labels?.singular ?? c.slug,
        group: c.admin?.group ?? null,
        useAsTitle: c.admin?.useAsTitle ?? null,
        hasStatus: c.status === true,
      }));
      // Derive the readable subset from the shared scope check rather than
      // re-testing membership here -- see `filterByResource`.
      return filterByResource(scope, mapped, c => String(c.slug));
    } catch (error) {
      this.logger.error("Failed to get registered collections", {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  private async getRegisteredSingles(
    scope: ReadableResources,
    /** Collects the slugs left out as kept off the dashboard, for the figures read elsewhere. */
    keptOff?: KeptOffRead
  ): Promise<RegisteredSingle[]> {
    try {
      const singleRegistryService = container.get<{
        getAllSingles: () => Promise<
          Array<
            RegisteredSingle & {
              /** Who defines it, read with `admin` by the kept-off rule. */
              source?: string;
              admin?: unknown;
            }
          >
        >;
      }>("singleRegistryService");

      // Kept off the dashboard, for the reason the collections above are.
      const singles = (await singleRegistryService.getAllSingles()).filter(
        single => !leftOut("single", single, keptOff?.slugs)
      );
      if (keptOff) keptOff.complete = true;
      return filterByResource(scope, singles, s => String(s.slug));
    } catch (error) {
      this.logger.error("Failed to get registered singles", {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Format a Date for raw-SQL bind parameters per dialect.
   *
   * Phase A follow-up (2026-05-01) — `BaseService.formatDateForDb()`
   * returns the Date unchanged; that works for Drizzle's typed query
   * builder (which converts based on column mode) but breaks raw
   * `adapter.executeQuery(sql, [date])` paths on SQLite, where
   * better-sqlite3 throws "can only bind numbers, strings, bigints,
   * buffers, and null" on Date objects.
   *
   * Per-dialect format:
   *   - SQLite: epoch SECONDS (matches Drizzle's `integer mode:"timestamp"`
   *     storage, which is what every timestamp column in the schema uses).
   *   - MySQL: 'YYYY-MM-DD HH:MM:SS' (DATETIME/TIMESTAMP format).
   *   - PostgreSQL: ISO 8601 string (driver converts to timestamp natively).
   *
   * Helper kept local to this service since it's the only raw-query
   * consumer; promote to BaseService if more services need it.
   */
  private dateForRawBind(date: Date = new Date()): SqlParam {
    if (this.dialect === "sqlite") {
      return Math.floor(date.getTime() / 1000);
    }
    if (this.dialect === "mysql") {
      return date.toISOString().slice(0, 19).replace("T", " ");
    }
    return date.toISOString();
  }

  private async countTable(tableName: string): Promise<number> {
    try {
      const quoteChar = this.dialect === "mysql" ? "`" : '"';
      const sql = `SELECT COUNT(*) as count FROM ${quoteChar}${tableName}${quoteChar}`;
      const result = await this.adapter.executeQuery<{
        count: number | string;
      }>(sql, []);
      return Number(result[0]?.count ?? 0);
    } catch (error) {
      this.logger.error(`Failed to count table: ${tableName}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * How many people or roles exist: the Team card's figures, by the same count
   * `/stats` gives a reader who may read them. The caller decides which figures
   * a reader may be given before asking, so a refused figure is never counted.
   */
  countTeamFigure(figure: "users" | "roles"): Promise<number> {
    return this.countTable(figure);
  }

  /**
   * Active, unexpired API keys: every user's, or one owner's, which is what
   * that caller's key list shows.
   */
  private async countActiveApiKeys(owner: ApiKeyCountScope): Promise<number> {
    try {
      const { sql, params } = this.activeApiKeyQuery(owner);
      const result = await this.adapter.executeQuery<{
        count: number | string;
      }>(sql, params);
      return Number(result[0]?.count ?? 0);
    } catch (error) {
      this.logger.error("Failed to count active API keys", {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * The SQL and binds counting active, unexpired keys, narrowed to one owner
   * unless the scope is every user's.
   *
   * The binds are primitives on every dialect. SQLite cannot bind a Date or a
   * boolean (better-sqlite3 refuses them), so the time is formatted up front
   * and "active" is bound as 1 everywhere but PostgreSQL, whose column is a
   * real boolean.
   */
  private activeApiKeyQuery(owner: ApiKeyCountScope): {
    sql: string;
    params: SqlParam[];
  } {
    const q = this.dialect === "mysql" ? "`" : '"';
    const at = (n: number) => (this.dialect === "postgresql" ? `$${n}` : "?");
    const active: SqlParam = this.dialect === "postgresql" ? true : 1;
    const params: SqlParam[] = [active, this.dateForRawBind()];
    let sql =
      `SELECT COUNT(*) as count FROM ${q}api_keys${q} ` +
      `WHERE ${q}is_active${q} = ${at(1)} ` +
      `AND (${q}expires_at${q} IS NULL OR ${q}expires_at${q} > ${at(2)})`;
    if (owner.kind === "owner") {
      sql += ` AND ${q}user_id${q} = ${at(3)}`;
      params.push(owner.userId);
    }
    return { sql, params };
  }

  /**
   * The last 24 hours of activity this caller may be told about, without the collections and
   * Singles kept off the dashboard, counted by the activity feed's own walk.
   *
   * 🔴 One question, one implementation: the feed authorizes each row's DOCUMENT as the caller,
   * and a count beside it that filtered only by the resource scope counted rows the feed would
   * withhold, so the figure said changes existed that the caller could not see. The walk is
   * bounded; past its bound the figure is a floor (`atLeast`), drawn `N+`.
   *
   * 0 when either registry read that names the kept-off content did not complete: counting then
   * would include exactly the activity the figure promises to leave out. 0 is also the answer on
   * a failure, as it always was for this figure.
   */
  private async countRecentChangesOutside(
    scope: ReadableResources,
    caller: ReadCaller,
    keptOff: Record<DashboardContentKind, KeptOffRead>
  ): Promise<RecentActivityCount> {
    const none: RecentActivityCount = { count: 0, atLeast: false };
    if (!keptOff.collection.complete || !keptOff.single.complete) return none;
    try {
      return await container
        .get<ActivityLogService>("activityLogService")
        .countRecentActivity({
          since: new Date(Date.now() - 24 * 60 * 60 * 1000),
          scope,
          caller,
          singles: { keptOff: keptOff.single.slugs, complete: true },
          keptOffCollections: keptOff.collection.slugs,
        });
    } catch (error) {
      this.logger.error("Failed to count recent changes", {
        error: error instanceof Error ? error.message : String(error),
      });
      return none;
    }
  }

  private async countRegistryItems(serviceName: string): Promise<number> {
    try {
      const service = container.get<{
        listComponents?: (opts: {
          limit: number;
        }) => Promise<{ total: number }>;
        listSingles?: (opts: { limit: number }) => Promise<{ total: number }>;
      }>(serviceName);

      const listFn =
        serviceName === "fieldGroupRegistryService"
          ? service.listComponents
          : service.listSingles;

      if (listFn) {
        const result = await listFn.call(service, { limit: 1 });
        return result.total;
      }

      return 0;
    } catch (error) {
      this.logger.error(`Failed to count registry items: ${serviceName}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  private async getCollectionCounts(
    collections: CollectionInfo[],
    caller: ReadCaller
  ): Promise<CollectionCount[]> {
    const results = await Promise.all(
      collections.map(async coll => ({
        slug: coll.slug,
        label: coll.label,
        group: coll.group,
        count: await this.countReadableEntries(coll, caller),
      }))
    );
    return results;
  }

  /**
   * How many entries of ONE collection this caller may read.
   *
   * This used to be `countTable`, a bare `SELECT COUNT(*)` over the physical
   * table. The read SCOPE decides whether a collection appears here at all; it
   * says nothing about which rows inside it the caller may read, so the count
   * reported rows the row read withholds -- unpublished ones a public reader
   * never sees among them.
   *
   * `overrideAccess: false` plus `user` is what closes it: `countEntries` runs
   * `checkCollectionAccess`, which
   * is the same WHERE predicate the list read applies. `getRecentEntries` takes
   * the identical path for the same reason.
   *
   * `status` defaults to `"all"`, the one WIDENING option, and it keeps the
   * number MEANING what it meant: an untrusted count that states nothing gets
   * `resolveStatusFilter`'s `published` default, so without it the
   * dashboard's per-collection totals would quietly exclude drafts and stop
   * agreeing with the draft/published breakdown beside them. Under `"all"` no
   * status condition is built at all, for the main row or a localized
   * collection's per-locale `_status` companion.
   *
   * `getCollectionContent` and `getContentTable` call this same method with
   * `"published"` and `"draft"` explicitly, rather than a second
   * implementation of "how many rows of this collection can this caller
   * read": one question, one implementation, so the total and the breakdown
   * cannot silently drift apart the way a raw `SELECT ... GROUP BY` and this
   * access-controlled count already had.
   *
   * `"draft"` is the collection list's Draft filter (`LIST_DRAFT_FILTER`), so
   * every draft figure the dashboard shows is the number that list holds.
   */
  private async countReadableEntries(
    coll: CollectionInfo,
    caller: ReadCaller,
    entries: EntryCount = "all"
  ): Promise<number> {
    try {
      const result = await requireNextly().count({
        collection: coll.slug,
        overrideAccess: false,
        user: caller.user,
        // `satisfies` makes the field name a COMPILE-TIME boundary: a
        // conditional spread is exempt from excess-property checking, so a
        // wrong key here would compile clean and be dropped silently, leaving
        // an API key counted by its minter's roles. Same pattern as
        // `getRecentFromCollection`'s `find()` call.
        ...(caller.authenticatedScope
          ? ({ actor: caller.authenticatedScope } satisfies Pick<
              CountArgs<string>,
              "actor"
            >)
          : {}),
        ...(entries === "draft" ? LIST_DRAFT_FILTER : { status: entries }),
      });
      return result.total;
    } catch (error) {
      // A collection whose table is not yet created, or whose read the caller
      // is refused outright, contributes zero rather than failing the whole
      // dashboard -- the same posture `getRecentFromCollection` takes.
      this.logger.debug(`Failed to count entries in ${coll.slug}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Each collection's total, and its draft/published split, read through the
   * SAME access-enforced path as the total.
   *
   * The split used to be a raw `SELECT ... GROUP BY status` over the physical
   * table -- ignoring the collection's access gate entirely, so it reported
   * every row split by lifecycle to a reader who could see only a fraction of
   * them. That number both disclosed rows the read access withholds and
   * disagreed with the per-collection total computed beside it.
   *
   * A collection WITHOUT the Draft/Published lifecycle has no split to make:
   * every row this caller may read counts as published, so its total is used
   * rather than asked for again.
   *
   * A lifecycle collection's total CANNOT be split into `published` and `draft`
   * by subtracting one from the other. A due RELEASE adjusts the `"published"`
   * read alone -- revealing a draft whose scheduled publish has arrived, or
   * hiding a published row whose scheduled unpublish has arrived (see
   * `collection-query-service.ts`'s `releaseDecisions`, which only fires for
   * `status: "published"`) -- while `"draft"` and `"all"` apply no such
   * adjustment, and the drafts are the list's Draft filter rather than every
   * state the workflow does not publish. So the three numbers are not
   * guaranteed to sum, and each is asked for explicitly rather than derived.
   */
  private async getCollectionContent(
    collections: CollectionInfo[],
    caller: ReadCaller
  ): Promise<CollectionContent[]> {
    const counts = await this.getCollectionCounts(collections, caller);
    return Promise.all(
      collections.map(async (coll, index) => {
        const total = counts[index];
        if (!coll.hasStatus) {
          return { ...total, published: total.count, draft: 0 };
        }
        const [published, draft] = await Promise.all([
          this.countReadableEntries(coll, caller, "published"),
          this.countReadableEntries(coll, caller, "draft"),
        ]);
        return { ...total, published, draft };
      })
    );
  }

  /**
   * The dashboard's Content table, as this caller may see it: what
   * `system:content` answers.
   *
   * The rows are every collection and Single this caller may read on the
   * dashboard (the registry reads `/stats` makes, so one kept off the
   * dashboard is absent here as it is there), at most `limit` of them, and
   * `total` counts all of them.
   *
   * Which rows make the page comes from each one's OWN last update: a
   * collection's newest entry this caller may read (`getRecentFromCollection`,
   * one entry, the access-enforced read), and a Single's document as stored.
   * A write the trail records both moves that date and files the change the
   * Updated column then shows, and a row whose latest write the trail missed
   * shows that date itself (`updateFields`), so the column never shows a row
   * older than the order ranks it. Ranked newest first, then the rest by label, the
   * collections holding no entries this caller may read last (`inTableOrder`).
   * A ranking drawn from a window of the activity trail alone would not do:
   * one collection saved often fills any window, and every other subject's
   * latest save then falls outside it.
   *
   * That read is bounded: at most `RANKING_READS` subjects are read, at most
   * `READ_CONCURRENCY` at once, so a load's work does not grow with the
   * install. Which subjects are read is `rankingOrder`'s: every one the
   * trail's window holds a save of, then the rest by label. A subject past the
   * bound is never read and never makes the page, which is never longer than
   * the bound.
   *
   * Only the rows drawn cost more: each collection on the page its total, its
   * drafts and its create decision, at most `READ_CONCURRENCY` rows at once.
   *
   * Updated and who made it come from one source (`updateFields`): the
   * trail's latest change of the subject, a publish or an unpublish on its own
   * included, where the trail holds one; else the row's own date, naming
   * nobody, so a row whose changes the trail no longer holds still shows its
   * date. ONE bounded read of the trail (`latestSaves`) names the subjects it
   * holds a change of, and a drawn collection or Single it does not is asked
   * on its own (`latestChangeOf`).
   *
   * Every number is the caller's own: the counts through the access-enforced
   * count, the drafts by the collection list's Draft filter, the newest entry
   * through the ordinary read, the create decision the one a real write makes,
   * and the saves each authorized as the caller by the trail's own walk.
   */
  async getContentTable(options: {
    scope: ReadableResources;
    caller: ReadCaller;
    /** How many rows to draw; clamped as every widget query's limit is. */
    limit?: number;
  }): Promise<ContentTable> {
    const keptOffCollections: KeptOffRead = {
      slugs: new Set(),
      complete: false,
    };
    const keptOffSingles: KeptOffRead = { slugs: new Set(), complete: false };
    const collections = await this.getRegisteredCollections(
      options.scope,
      keptOffCollections
    );
    const singles = await this.getRegisteredSingles(
      options.scope,
      keptOffSingles
    );
    const subjects: ContentSubject[] = [
      ...collections.map(info => ({
        kind: "collection" as const,
        slug: info.slug,
        label: info.label,
        info,
      })),
      ...singles.map(single => ({
        kind: "single" as const,
        slug: single.slug,
        label: single.label ?? single.slug,
        ...(single.tableName === undefined
          ? {}
          : { tableName: single.tableName }),
      })),
    ];
    const trail: TrailSubjects = {
      scope: options.scope,
      caller: options.caller,
      singles: {
        labels: new Map(
          singles.map(single => [single.slug, single.label ?? single.slug])
        ),
        keptOff: keptOffSingles.slugs,
        complete: keptOffSingles.complete,
      },
      keptOffCollections: {
        slugs: keptOffCollections.slugs,
        complete: keptOffCollections.complete,
      },
    };
    // The trail's latest saves first: they decide which subjects are read for
    // the ranking, and name who saved the drawn rows.
    const recent = await this.latestSaves(trail, MAX_WIDGET_LIMIT);
    const saved = latestSaveOf(recent.saves);
    const dated = await mapBounded(
      rankingOrder(subjects, saved).slice(0, RANKING_READS),
      READ_CONCURRENCY,
      subject => this.withOwnUpdate(subject, options.caller)
    );
    const page = inTableOrder(dated).slice(
      0,
      effectiveWidgetLimit(options.limit)
    );
    const context: RowContext = {
      caller: options.caller,
      trail,
      complete: recent.complete,
      saved,
      mayCreate: await this.createDecision(options.caller),
      mayUpdate: updateDecision(options.caller),
    };
    // In the page's order, which is already the table's; bounded as the
    // ranking's reads are, since each collection's row is four reads more.
    const rows = await mapBounded(page, READ_CONCURRENCY, subject =>
      this.contentRow(subject, context)
    );
    return {
      rows,
      total: subjects.length,
      byKind: { collection: collections.length, single: singles.length },
    };
  }

  /**
   * One drawn row: a Single's from its document, its latest change and its
   * update decision, a collection's with its entries, its drafts and its
   * create decision counted as well.
   */
  private async contentRow(
    subject: DatedSubject,
    context: RowContext
  ): Promise<ContentTableRow> {
    const latest = this.latestChangeOf(subject, context);
    if (subject.kind === "single") {
      const [change, canUpdate] = await Promise.all([
        latest,
        context.mayUpdate(subject.slug),
      ]);
      return singleRow(subject, change, canUpdate);
    }
    const [count, draft, canCreate, change] = await Promise.all([
      this.countReadableEntries(subject.info, context.caller),
      subject.info.hasStatus
        ? this.countReadableEntries(subject.info, context.caller, "draft")
        : Promise.resolve(null),
      context.mayCreate(subject.slug),
      latest,
    ]);
    return {
      kind: "collection",
      slug: subject.slug,
      label: subject.label,
      group: subject.info.group,
      count,
      draft,
      canCreate,
      ...updateFields(subject.own, change),
    };
  }

  /**
   * `subject` with its own last update: a collection's newest entry this
   * caller may read, through the ordinary access-enforced read, or a Single's
   * document as stored.
   */
  private async withOwnUpdate(
    subject: ContentSubject,
    caller: ReadCaller
  ): Promise<DatedSubject> {
    if (subject.kind === "single") {
      return { ...subject, own: await this.singleDocument(subject) };
    }
    const [newest] = await this.getRecentFromCollection(
      subject.info,
      1,
      caller
    );
    return {
      ...subject,
      own:
        newest === undefined
          ? undefined
          : ownUpdate(newest.id, newest.updatedAt),
    };
  }

  /**
   * A Single's document as its table stores it: its id, and when it was last
   * updated. `undefined` while it has none.
   *
   * Read from the table rather than through `findSingle`, because that read
   * creates a missing document, and a dashboard load must not write. The
   * caller's read of the Single was already decided by the scope that put it
   * on the table, and a Single has one document, with no rule over its rows, so
   * the two columns read here are what that read would return for it.
   */
  private async singleDocument(single: {
    slug: string;
    tableName?: string;
  }): Promise<OwnUpdate | undefined> {
    if (single.tableName === undefined) return undefined;
    try {
      return storedDocument(
        await this.adapter.selectOne<{ id?: unknown; updated_at?: unknown }>(
          single.tableName,
          { columns: ["id", "updated_at"] }
        )
      );
    } catch (error) {
      this.logger.debug(`Failed to read when ${single.slug} was updated`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  /**
   * The trail's latest change of a drawn row's subject, which its Updated and
   * its name are then both taken from: the subject's latest change in the
   * window, or, when the window did not reach the trail's end and holds none
   * of it, its latest change past the window, read for that collection or that
   * Single alone and authorized as the caller by the same walk. A collection's
   * is its latest change of any entry. A Single's is only one of the document
   * it holds now: the trail keeps the changes of the document a Single had
   * before it was deleted and created again under its slug, and those are not
   * of this one. Nothing for a row with no entry or document.
   */
  private async latestChangeOf(
    subject: DatedSubject,
    context: RowContext
  ): Promise<RecentEdit | undefined> {
    const own = subject.own;
    if (own === undefined) return undefined;
    const change =
      context.saved.get(subjectKey(subject.kind, subject.slug)) ??
      (context.complete
        ? undefined
        : (await this.latestSaves(narrowedTo(context.trail, subject), 1))
            .saves[0]);
    if (subject.kind === "single" && change?.entryId !== own.id) {
      return undefined;
    }
    return change;
  }

  /**
   * The documents most recently changed that this caller may see, newest
   * first, at most `limit` of them, and whether that reached the end of the
   * trail: the activity trail's own walk (`getRecentEdits`), each change
   * authorized as the caller. A publish or an unpublish on its own counts
   * (`statusChanges`), since it is the change that moved the row's own date.
   *
   * A failed read answers no saves and an incomplete window, so the table
   * still draws its rows, naming nobody, rather than failing.
   */
  private async latestSaves(
    subjects: TrailSubjects,
    limit: number
  ): Promise<{ saves: RecentEdit[]; complete: boolean }> {
    try {
      const { edits, hasMore } = await container
        .get<ActivityLogService>("activityLogService")
        .getRecentEdits({ ...subjects, limit, statusChanges: true });
      return { saves: edits, complete: !hasMore };
    } catch (error) {
      this.logger.error("Failed to read the latest saves", {
        error: error instanceof Error ? error.message : String(error),
      });
      return { saves: [], complete: false };
    }
  }

  /**
   * Whether this caller may create an entry in a collection: the decision a
   * real write makes (`createVerdict`), and never for a collection whose
   * definition turns creating off in the admin (`createDisabledSlugs`).
   *
   * Fails closed: while which collections turn creating off is unknown, and
   * for a decision that throws, the answer is no, so a + is never drawn onto
   * a refusal.
   */
  private async createDecision(
    caller: ReadCaller
  ): Promise<(slug: string) => Promise<boolean>> {
    const disabled = await createDisabledSlugs().catch(() => undefined);
    if (disabled === undefined) return () => Promise.resolve(false);
    const verdict = createVerdict(caller);
    return slug =>
      disabled.has(slug)
        ? Promise.resolve(false)
        : verdict(slug).catch(() => false);
  }

  /**
   * Recent entries from ONE collection, read through the ordinary
   * access-controlled path.
   *
   * This used to be a hand-built `SELECT ... ORDER BY updated_at DESC
   * LIMIT n` against the physical table. That skipped field-level access
   * control, the collection's own access `where` constraints, the
   * draft/publish lifecycle (it string-matched a `status` column, so a
   * localized collection's per-locale `_status` companion was invisible),
   * locale scoping and hooks -- and returned the titles of entries the
   * caller could not read.
   *
   * `overrideAccess: false` plus `user` is what enforces all of it, and is
   * the same path a REST read takes.
   */
  private async getRecentFromCollection(
    coll: CollectionInfo,
    limit: number,
    caller: ReadCaller
  ): Promise<RecentEntry[]> {
    try {
      const titleField = coll.useAsTitle ?? "title";
      const result = await requireNextly().find({
        collection: coll.slug,
        limit,
        sort: "-updatedAt",
        overrideAccess: false,
        // The caller WHOLE: `user` carries resolved role slugs, and `actor`
        // (translated internally to `authenticatedScope`) keeps an API key
        // judged on its own stamped grant rather than its minter's roles.
        // Reducing either to an id is how a read silently answers as
        // somebody with different rights.
        user: caller.user,
        // `satisfies` makes the field name a COMPILE-TIME boundary rather
        // than a convention: `find()`'s excess-property check is exempt from
        // a conditional spread (`...(cond ? {x} : {})`), which is exactly
        // why a wrong key here -- `authenticatedScope`, the name this value
        // has on `caller` -- would compile clean and be silently dropped by
        // `find()` instead of failing loudly. Typing the spread's operand
        // against the real option name closes that gap: rename `actor`
        // anywhere in `FindArgs` and this line stops compiling.
        ...(caller.authenticatedScope
          ? ({ actor: caller.authenticatedScope } satisfies Pick<
              FindArgs<string>,
              "actor"
            >)
          : {}),
        // The dashboard shows what the editor can act on, drafts included.
        // `status: "all"` is the one WIDENING option in this call -- it also
        // propagates into relationship expansion (see
        // `status-filter.ts`'s `expansionStatusScope`) -- and under it
        // `resolveStatusFilter` returns null: no status condition is built
        // at all, for the main row or its per-locale `_status` companion.
        // That is not "the lifecycle filter handles locales correctly"; it
        // is that NO filter is applied, so none can be wrong for either.
        status: "all",
        // `entryHeading` walks the nominated field and then every conventional
        // name in `COMMON_TITLE_FIELDS`, but the Direct
        // API's `select` is a real projection (`applyFieldSelection` in
        // `collection-query-service.ts` keeps only `id`, the system
        // timestamps, and whatever key is named here) -- so `title` and
        // `name` reach the resolver only when they are asked for by name.
        // Without them the fallback candidates are simply absent from every
        // real read, and the chain can never do anything but return the id:
        // dead code that only "worked" in a test handing the resolver an
        // unprojected row. Selecting a field twice when `titleField` already
        // IS one of them is harmless -- every value here is `true`.
        //
        // 🔴 SPREAD from the same list the walk reads, not written out. A
        // projection that names fewer candidates than the walk considers is
        // the dead-code state above wearing a different shape: the walk looks
        // widened and every candidate it gained is missing from the row.
        select: {
          id: true,
          updatedAt: true,
          [titleField]: true,
          ...Object.fromEntries(
            COMMON_TITLE_FIELDS.map(name => [name, true] as const)
          ),
          ...(coll.hasStatus ? { status: true } : {}),
        },
      });

      const rows = result.items ?? [];

      return rows.map(row => {
        // `??` against an `unknown` value narrows the checked side to `{}`,
        // which still has nothing but `Object.prototype.toString` -- calling
        // `String()` on that renders `[object Object]` instead of failing
        // loudly. Narrow by `typeof`/`instanceof` first so every branch that
        // reaches `String()` (or a bare `.toLowerCase()`) is already known to
        // be a real primitive. `entryHeading` is that narrowing for the title,
        // and it is the SAME walk the activity feed records its headings with,
        // so one entry does not get two different names depending on which
        // surface names it.
        const updatedAt =
          row.updatedAt instanceof Date
            ? row.updatedAt.toISOString()
            : typeof row.updatedAt === "string"
              ? row.updatedAt
              : "";

        let status: "published" | "draft" | "none" = "none";
        if (coll.hasStatus && typeof row.status === "string") {
          status = row.status.toLowerCase() === "draft" ? "draft" : "published";
        }

        const id = String(row.id);
        return {
          id,
          title: entryHeading(row, titleField, id),
          collectionSlug: coll.slug,
          collectionLabel: coll.label,
          status,
          updatedAt,
        };
      });
    } catch (error) {
      // A collection whose table is not yet created, or which the caller
      // may not read at all, contributes nothing rather than failing the
      // feed.
      this.logger.debug(`Failed to get recent entries from ${coll.slug}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }
}

/**
 * A Single as the registry lists it: its slug, its label, and the table its one
 * document is stored in, which the Content table reads the last update from.
 */
interface RegisteredSingle {
  slug: string;
  label?: string;
  tableName?: string;
}

/** Simplified collection info for internal use. */
interface CollectionInfo {
  slug: string;
  tableName: string;
  label: string;
  group: string | null;
  useAsTitle: string | null;
  hasStatus: boolean;
}
