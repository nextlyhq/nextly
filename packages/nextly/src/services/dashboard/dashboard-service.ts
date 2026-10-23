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

import { container } from "../../di/container";
import { requireNextly } from "../../direct-api/nextly";
import type { CountArgs, FindArgs } from "../../direct-api/types";
import { COMMON_TITLE_FIELDS } from "../../domains/collections/entry-title";
import {
  keptOffDashboard,
  type DashboardContentKind,
} from "../../domains/widgets/kept-off-dashboard";
import { entryHeading } from "../../lib/entry-heading";
import { BaseService } from "../base-service";
import type { Logger } from "../shared";

import type {
  ActivityLogService,
  RecentActivityCount,
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
 * The one per-collection reading the dashboard makes. `/stats` derives its
 * counts and its overall breakdown from these rows, and `system:content`
 * answers them, so the Content card and the summary cannot come to disagree.
 * A collection without the Draft/Published lifecycle has no drafts: every entry
 * the caller may read is published.
 */
export interface CollectionContent extends CollectionCount {
  published: number;
  draft: number;
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
  record: { slug: string; admin?: unknown },
  keptOff: Set<string> | undefined
): boolean {
  if (!keptOffDashboard(record)) return false;
  keptOff?.add(record.slug);
  return true;
}

/**
 * The page of collections a content answer counts: all of them in slug order,
 * cut to `limit` when there is one. A stated order, so the same install gives
 * the same page on every read, whatever order the registry returns.
 */
function contentPage<T extends { slug: string }>(
  collections: readonly T[],
  limit: number | undefined
): T[] {
  const ordered = [...collections].sort((a, b) =>
    a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0
  );
  return limit === undefined ? ordered : ordered.slice(0, limit);
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
        c => !leftOut(c, keptOff?.slugs)
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
  ): Promise<Array<{ slug: string }>> {
    try {
      const singleRegistryService = container.get<{
        getAllSingles: () => Promise<Array<{ slug: string; admin?: unknown }>>;
      }>("singleRegistryService");

      // Kept off the dashboard, for the reason the collections above are.
      const singles = (await singleRegistryService.getAllSingles()).filter(
        single => !leftOut(single, keptOff?.slugs)
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
   * `getCollectionContent` calls this same method with `"published"` and
   * `"draft"` explicitly, rather than a second implementation of "how many
   * rows of this collection can this caller read": one question, one
   * implementation, so the total and the breakdown cannot silently drift
   * apart the way a raw `SELECT ... GROUP BY` and this access-controlled
   * count already had.
   */
  private async countReadableEntries(
    coll: CollectionInfo,
    caller: ReadCaller,
    status: "all" | "published" | "draft" = "all"
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
        status,
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
   * adjustment. So the three numbers are not guaranteed to sum, and each is
   * asked for explicitly rather than derived.
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
   * The collections this caller may see on the dashboard, each with its total
   * and its published/draft split: what `system:content` answers.
   *
   * The same registry read and the same per-collection reading `/stats` makes,
   * so a collection kept off the dashboard is absent here as it is there, and
   * every number is the caller's own.
   *
   * With a `limit`, the page is chosen before anything is counted: the
   * collections in slug order, the first `limit` of them. Each collection
   * costs up to three counts, so counting every one and then keeping a page
   * would grow the dashboard's work with the install rather than the card.
   */
  async getContentByCollection(options: {
    scope: ReadableResources;
    caller: ReadCaller;
    limit?: number;
  }): Promise<CollectionContent[]> {
    const collections = await this.getRegisteredCollections(options.scope, {
      slugs: new Set(),
      complete: false,
    });
    return this.getCollectionContent(
      contentPage(collections, options.limit),
      options.caller
    );
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

/** Simplified collection info for internal use. */
interface CollectionInfo {
  slug: string;
  tableName: string;
  label: string;
  group: string | null;
  useAsTitle: string | null;
  hasStatus: boolean;
}
