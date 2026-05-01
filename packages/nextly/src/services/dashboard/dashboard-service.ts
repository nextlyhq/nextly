/**
 * Dashboard Service
 *
 * Aggregates content-centric statistics, recent entries across collections,
 * and project-wide metrics for the admin dashboard. Uses the database adapter
 * directly for simple read-only aggregate queries — no hooks, access control,
 * or relationship expansion needed for dashboard stats.
 *
 * @module services/dashboard/dashboard-service
 * @since 1.0.0
 */

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import type { SqlParam } from "@revnixhq/adapter-drizzle/types";

import { container } from "../../di/container";
import { BaseService } from "../base-service";
import type { Logger } from "../shared";

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
  components: number;
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
   * Runs all count queries in parallel for fast response. Uses the database
   * adapter directly for simple COUNT(*) queries.
   */
  async getStats(options?: {
    readableResources?: Set<string>;
  }): Promise<DashboardStatsResponse> {
    const collections = await this.getRegisteredCollections(
      options?.readableResources
    );
    const singles = await this.getRegisteredSingles(options?.readableResources);

    const [
      collectionCounts,
      mediaCount,
      recentChanges,
      userCount,
      roleCount,
      permissionCount,
      componentCount,
      apiKeyCount,
      statusBreakdown,
    ] = await Promise.all([
      this.getCollectionCounts(collections),
      this.countTable("media"),
      this.countRecentChanges24h(),
      this.countTable("users"),
      this.countTable("roles"),
      this.countTable("permissions"),
      this.countRegistryItems("componentRegistryService"),
      this.countActiveApiKeys(),
      this.getContentStatusBreakdown(collections),
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
      components: componentCount,
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
   */
  async getRecentEntries(
    limit: number = 5,
    readableResources?: Set<string>
  ): Promise<RecentEntriesResponse> {
    const clampedLimit = Math.min(Math.max(limit, 1), 20);
    const collections = await this.getRegisteredCollections(readableResources);

    let collectionsToQuery = collections;
    if (collections.length > MAX_COLLECTIONS_FOR_RECENT) {
      this.logger.warn(
        `Dashboard: ${collections.length} collections registered, ` +
          `querying only the first ${MAX_COLLECTIONS_FOR_RECENT} for recent entries`
      );
      collectionsToQuery = collections.slice(0, MAX_COLLECTIONS_FOR_RECENT);
    }

    const entryPromises = collectionsToQuery.map(coll =>
      this.getRecentFromCollection(coll, clampedLimit)
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
  async getProjectStats(options?: {
    readableResources?: Set<string>;
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
        { key: "components", label: "Components", value: dashStats.components },
        { key: "singles", label: "Singles", value: dashStats.singles },
        { key: "users", label: "Users", value: dashStats.users },
        { key: "apiKeys", label: "API Keys", value: dashStats.apiKeys },
        { key: "locales", label: "Locales", value: 1 }, // Placeholder until i18n
      ],
    };
  }

  private async getRegisteredCollections(
    readableResources?: Set<string>
  ): Promise<CollectionInfo[]> {
    try {
      const registryService = container.get<{
        getAllCollections: () => Promise<
          Array<{
            slug: string;
            tableName: string;
            labels: { singular: string; plural: string };
            admin?: { useAsTitle?: string; group?: string };
            fields: Array<{ name: string; type: string }>;
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
        hasStatus:
          c.fields?.some(f => f.name === "_status" || f.name === "status") ??
          false,
      }));
      if (!readableResources || readableResources.size === 0) return mapped;
      return mapped.filter(c => readableResources.has(String(c.slug)));
    } catch (error) {
      this.logger.error("Failed to get registered collections", {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  private async getRegisteredSingles(
    readableResources?: Set<string>
  ): Promise<Array<{ slug: string }>> {
    try {
      const singleRegistryService = container.get<{
        getAllSingles: () => Promise<Array<{ slug: string }>>;
      }>("singleRegistryService");

      const singles = await singleRegistryService.getAllSingles();
      if (!readableResources || readableResources.size === 0) return singles;

      return singles.filter(s => readableResources.has(String(s.slug)));
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

  private async countRecentChanges24h(): Promise<number> {
    try {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      // Phase A follow-up: same dialect-aware formatter as above. The
      // legacy `this.formatDateForDb(cutoff)` returns the raw Date which
      // SQLite rejects.
      const cutoffParam = this.dateForRawBind(cutoff);
      const q = this.dialect === "mysql" ? "`" : '"';
      const ph = this.dialect === "postgresql" ? "$1" : "?";

      const sql =
        `SELECT COUNT(*) as count FROM ${q}activity_log${q} ` +
        `WHERE ${q}created_at${q} > ${ph}`;

      const result = await this.adapter.executeQuery<{
        count: number | string;
      }>(sql, [cutoffParam]);

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
        serviceName === "componentRegistryService"
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
    collections: CollectionInfo[]
  ): Promise<CollectionCount[]> {
    const results = await Promise.all(
      collections.map(async coll => {
        const count = await this.countTable(coll.tableName);
        return {
          slug: coll.slug,
          label: coll.label,
          group: coll.group,
          count,
        };
      })
    );
    return results;
  }

  /**
   * Get draft vs published content breakdown across all collections.
   *
   * Collections without a `_status` or `status` field count all entries
   * as published.
   */
  private async getContentStatusBreakdown(
    collections: CollectionInfo[]
  ): Promise<ContentStatus> {
    let published = 0;
    let draft = 0;

    const results = await Promise.all(
      collections.map(async coll => {
        if (!coll.hasStatus) {
          // No status field — all entries count as published
          const total = await this.countTable(coll.tableName);
          return { published: total, draft: 0 };
        }

        const statusField = coll.hasStatus ? "status" : "_status";
        return this.countByStatus(coll.tableName, statusField);
      })
    );

    for (const result of results) {
      published += result.published;
      draft += result.draft;
    }

    return { published, draft };
  }

  private async countByStatus(
    tableName: string,
    statusColumn: string
  ): Promise<{ published: number; draft: number }> {
    try {
      const q = this.dialect === "mysql" ? "`" : '"';
      const sql =
        `SELECT ${q}${statusColumn}${q} as status, COUNT(*) as count ` +
        `FROM ${q}${tableName}${q} ` +
        `GROUP BY ${q}${statusColumn}${q}`;

      const rows = await this.adapter.executeQuery<{
        status: string | null;
        count: number | string;
      }>(sql, []);

      let published = 0;
      let draft = 0;

      for (const row of rows) {
        const count = Number(row.count ?? 0);
        const status = String(row.status ?? "").toLowerCase();
        if (status === "draft") {
          draft += count;
        } else {
          // "published", null, or any other value counts as published
          published += count;
        }
      }

      return { published, draft };
    } catch (error) {
      this.logger.error(`Failed to count by status: ${tableName}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return { published: 0, draft: 0 };
    }
  }

  private async getRecentFromCollection(
    coll: CollectionInfo,
    limit: number
  ): Promise<RecentEntry[]> {
    try {
      const q = this.dialect === "mysql" ? "`" : '"';
      const titleCol = coll.useAsTitle ?? "title";

      const selectCols = [`${q}id${q}`, `${q}updated_at${q}`];

      // Try to select the title column; if it doesn't exist the query
      // will just return NULL for it — we fall back to the entry ID.
      selectCols.push(`${q}${titleCol}${q}`);

      if (coll.hasStatus) {
        selectCols.push(`${q}status${q}`);
      }

      const sql =
        `SELECT ${selectCols.join(", ")} ` +
        `FROM ${q}${coll.tableName}${q} ` +
        `ORDER BY ${q}updated_at${q} DESC ` +
        `LIMIT ${limit}`;

      const rows = await this.adapter.executeQuery<Record<string, unknown>>(
        sql,
        []
      );

      return rows.map(row => {
        const title =
          row[titleCol] != null
            ? String(row[titleCol])
            : row.title != null
              ? String(row.title)
              : row.name != null
                ? String(row.name)
                : String(row.id);

        const updatedAt =
          row.updated_at instanceof Date
            ? row.updated_at.toISOString()
            : String(row.updated_at ?? "");

        let status: "published" | "draft" | "none" = "none";
        if (coll.hasStatus && row.status != null) {
          const s = String(row.status).toLowerCase();
          status = s === "draft" ? "draft" : "published";
        }

        return {
          id: String(row.id),
          title,
          collectionSlug: coll.slug,
          collectionLabel: coll.label,
          status,
          updatedAt,
        };
      });
    } catch (error) {
      // Silently skip collections that fail (e.g., table doesn't exist yet)
      this.logger.debug(`Failed to get recent entries from ${coll.tableName}`, {
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
