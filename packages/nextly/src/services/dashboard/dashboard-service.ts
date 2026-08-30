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
 * `permissions`, active API keys), which are uniformly unscoped, and for the
 * two `activity_log` aggregates, whose scoping is applied to the query itself.
 *
 * @module services/dashboard/dashboard-service
 * @since 1.0.0
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SqlParam } from "@nextlyhq/adapter-drizzle/types";

import { container } from "../../di/container";
import { getNextly } from "../../direct-api/nextly";
import type { CountArgs, FindArgs } from "../../direct-api/types";
import { entryHeading } from "../../lib/entry-heading";
import { BaseService } from "../base-service";
import type { Logger } from "../shared";

import {
  filterByResource,
  someResources,
  type ReadableResources,
  type ReadCaller,
} from "./readable-resources";

/** Content statistics for the hero stats row. */
export interface ContentStats {
  totalEntries: number;
  totalMedia: number;
  contentTypes: number;
  recentChanges24h: number;
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

/** Full dashboard stats response. */
export interface DashboardStatsResponse {
  content: ContentStats;
  status: ContentStatus;
  collectionCounts: CollectionCount[];
  users: number;
  roles: number;
  permissions: number;
  fieldGroups: number;
  singles: number;
  apiKeys: number;
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

/** Maximum number of collections to query for recent entries. */
const MAX_COLLECTIONS_FOR_RECENT = 20;

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
  }): Promise<DashboardStatsResponse> {
    // An omitted scope denies rather than allows. A caller that forgets to
    // pass one gets an empty dashboard, which is visible and reportable; the
    // old default returned everything, which was not.
    const scope = options.scope ?? someResources([]);
    const collections = await this.getRegisteredCollections(scope);
    const singles = await this.getRegisteredSingles(scope);

    // Computed first, rather than folded into the `Promise.all` below: the
    // status breakdown reuses these numbers for every collection without the
    // Draft/Published lifecycle (see `getContentStatusBreakdown`), which
    // needs the totals in hand before it can decide whether to ask for more.
    const collectionCounts = await this.getCollectionCounts(
      collections,
      options.caller
    );

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
      this.countTable("media"),
      this.countRecentChanges24h(scope),
      this.countTable("users"),
      this.countTable("roles"),
      this.countTable("permissions"),
      this.countRegistryItems("fieldGroupRegistryService"),
      this.countActiveApiKeys(),
      this.getContentStatusBreakdown(
        collections,
        collectionCounts,
        options.caller
      ),
    ]);

    const totalEntries = collectionCounts.reduce((sum, c) => sum + c.count, 0);

    return {
      content: {
        totalEntries,
        totalMedia: mediaCount,
        contentTypes: collections.length,
        recentChanges24h: recentChanges,
      },
      status: statusBreakdown,
      collectionCounts,
      users: userCount,
      roles: roleCount,
      permissions: permissionCount,
      fieldGroups: componentCount,
      singles: singles.length,
      apiKeys: apiKeyCount,
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
  }): Promise<ProjectStatsResponse> {
    const dashStats = await this.getStats(options);

    return {
      stats: [
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
      ],
    };
  }

  private async getRegisteredCollections(
    scope: ReadableResources
  ): Promise<CollectionInfo[]> {
    try {
      const registryService = container.get<{
        getAllCollections: () => Promise<
          Array<{
            slug: string;
            tableName: string;
            labels: { singular: string; plural: string };
            admin?: { useAsTitle?: string; group?: string };
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

      const collections = await registryService.getAllCollections();
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
    scope: ReadableResources
  ): Promise<Array<{ slug: string }>> {
    try {
      const singleRegistryService = container.get<{
        getAllSingles: () => Promise<Array<{ slug: string }>>;
      }>("singleRegistryService");

      const singles = await singleRegistryService.getAllSingles();
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

  private async countActiveApiKeys(): Promise<number> {
    try {
      const q = this.dialect === "mysql" ? "`" : '"';
      // Phase A follow-up (2026-05-01): raw SQL queries can't bind a Date
      // directly on SQLite (better-sqlite3 throws "can only bind numbers,
      // strings, bigints, buffers, and null"). PG and MySQL drivers
      // convert natively, but SQLite is strict. Format up-front per
      // dialect so the bind value is always a primitive. See companion
      // fix in `permission-cache-service.ts:222` (Phase A original).
      const now = this.dateForRawBind();
      const ph1 = this.dialect === "postgresql" ? "$1" : "?";
      const ph2 = this.dialect === "postgresql" ? "$2" : "?";
      const isActiveLiteral =
        this.dialect === "sqlite"
          ? "1"
          : this.dialect === "mysql"
            ? "1"
            : "true";

      const sql =
        `SELECT COUNT(*) as count FROM ${q}api_keys${q} ` +
        `WHERE ${q}is_active${q} = ${ph1} ` +
        `AND (${q}expires_at${q} IS NULL OR ${q}expires_at${q} > ${ph2})`;

      const params: SqlParam[] =
        this.dialect === "postgresql"
          ? [true, now]
          : [isActiveLiteral === "1" ? 1 : true, now];

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
   * Count the last 24 hours of `activity_log` rows the caller may READ.
   *
   * `activity_log` spans every collection, so an unscoped count answers a
   * different question from the `collectionCounts` beside it in the same
   * `/stats` response: one honours the caller's scope and the other does not,
   * and the number itself then discloses that changes exist outside the
   * caller's reach. `ActivityLogService.getRecentActivity` filters this table
   * with an `IN` on `collection`; this is the same filter applied to the count.
   *
   * The other counters in `getStats` (`media`, `users`, `roles`, `permissions`,
   * active API keys) stay unscoped. They are uniformly unscoped rather than
   * newly inconsistent, and what a scoped admin metric should mean is a design
   * question rather than a defect in this table's filter.
   *
   * @param scope - What the caller may read. An empty `some` returns 0 without
   *   querying: it admits nothing, and an empty `IN ()` is a syntax error on
   *   some dialects, so the short-circuit has to happen before the query is
   *   built rather than as a driver rejection swallowed by the catch below.
   */
  private async countRecentChanges24h(
    scope: ReadableResources
  ): Promise<number> {
    if (scope.kind === "some" && scope.resources.size === 0) return 0;

    try {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      // Phase A follow-up: same dialect-aware formatter as above. The
      // legacy `this.formatDateForDb(cutoff)` returns the raw Date which
      // SQLite rejects.
      const cutoffParam = this.dateForRawBind(cutoff);
      const q = this.dialect === "mysql" ? "`" : '"';

      // Placeholder numbering derives from `params.length` at the moment each
      // value is pushed, never from a fixed index: the `IN` list contributes
      // as many parameters as the scope has resources, so a hardcoded `$1`/`$2`
      // -- correct only while the query bound exactly one value -- would bind
      // the cutoff and the collection names to the wrong positions. Every
      // value goes through here, so no collection name is ever interpolated
      // into the SQL text.
      const params: SqlParam[] = [];
      const bind = (value: SqlParam): string => {
        params.push(value);
        return this.dialect === "postgresql" ? `$${params.length}` : "?";
      };

      let sql =
        `SELECT COUNT(*) as count FROM ${q}activity_log${q} ` +
        `WHERE ${q}created_at${q} > ${bind(cutoffParam)}`;

      if (scope.kind === "some") {
        const placeholders = [...scope.resources]
          .map(resource => bind(resource))
          .join(", ");
        sql += ` AND ${q}collection${q} IN (${placeholders})`;
      }

      const result = await this.adapter.executeQuery<{
        count: number | string;
      }>(sql, params);

      return Number(result[0]?.count ?? 0);
    } catch (error) {
      this.logger.error("Failed to count recent changes", {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
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
   * says nothing about which rows inside it the caller may read, so a
   * collection with an owner-only or custom stored read rule reported every
   * author's rows to every reader who could open it -- the count disclosing
   * exactly what the row read withholds.
   *
   * `overrideAccess: false` plus `user` is what closes it: `countEntries` runs
   * `checkCollectionAccess` and then applies `getAccessQueryConstraint`, which
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
   * `getContentStatusBreakdown` calls this same method with `"published"` and
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
      const result = await getNextly().count({
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
   * Draft vs published content breakdown, read through the SAME
   * access-enforced path as the per-collection totals beside it.
   *
   * This used to be a raw `SELECT ... GROUP BY status` over the physical
   * table -- ignoring both the collection's access rule and its stored
   * row-level constraint, so a collection with an owner-only read rule
   * reported every author's rows split by lifecycle to a reader who could see
   * only a fraction of them. That number both disclosed rows the read access
   * withholds and disagreed with `content.totalEntries`, computed beside it
   * from the access-controlled count.
   *
   * A collection WITHOUT the Draft/Published lifecycle has no split to make:
   * every row this caller may read counts as published. That total is
   * already sitting in `collectionCounts` -- computed one step before this
   * call, with the identical access rules -- so it is looked up rather than
   * asked for again.
   *
   * A lifecycle collection's total CANNOT be split into `published` and
   * `draft` by subtracting one from the other. A due RELEASE adjusts the
   * `"published"` read alone -- revealing a draft whose scheduled publish has
   * arrived, or hiding a published row whose scheduled unpublish has arrived
   * (see `collection-query-service.ts`'s `releaseDecisions`, which only fires
   * for `status: "published"`) -- while `"draft"` and `"all"` apply no such
   * adjustment. So the three numbers are not guaranteed to sum, and each is
   * asked for explicitly rather than derived.
   */
  private async getContentStatusBreakdown(
    collections: CollectionInfo[],
    collectionCounts: CollectionCount[],
    caller: ReadCaller
  ): Promise<ContentStatus> {
    const totalsBySlug = new Map(
      collectionCounts.map(c => [c.slug, c.count] as const)
    );
    let published = 0;
    let draft = 0;

    const results = await Promise.all(
      collections.map(async coll => {
        if (!coll.hasStatus) {
          // Same access rules, same rows, already counted for the total
          // above -- asking again would be a second implementation of the
          // same question.
          return { published: totalsBySlug.get(coll.slug) ?? 0, draft: 0 };
        }

        const [publishedCount, draftCount] = await Promise.all([
          this.countReadableEntries(coll, caller, "published"),
          this.countReadableEntries(coll, caller, "draft"),
        ]);
        return { published: publishedCount, draft: draftCount };
      })
    );

    for (const result of results) {
      published += result.published;
      draft += result.draft;
    }

    return { published, draft };
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
      const result = await getNextly().find({
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
        // `entryHeading`'s fallback chain is
        // `data[titleField] ?? data.title ?? data.name`, but the Direct
        // API's `select` is a real projection (`applyFieldSelection` in
        // `collection-query-service.ts` keeps only `id`, the system
        // timestamps, and whatever key is named here) -- so `title` and
        // `name` reach the resolver only when they are asked for by name.
        // Without them the fallback candidates are simply absent from every
        // real read, and the chain can never do anything but return the id:
        // dead code that only "worked" in a test handing the resolver an
        // unprojected row. Selecting a field twice when `titleField` already
        // IS `title` or `name` is harmless -- every value here is `true`.
        select: {
          id: true,
          updatedAt: true,
          [titleField]: true,
          title: true,
          name: true,
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
