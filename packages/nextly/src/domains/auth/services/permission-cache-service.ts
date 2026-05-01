import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import { and, eq, gt, lt, sql } from "drizzle-orm";

import { getAuthLogger } from "@nextly/lib/logger";

import { BaseService } from "../../../services/base-service";
import type { Logger } from "../../../services/shared";

import { PermissionCheckerService } from "./permission-checker-service";

// Rate-limited error logging to prevent log flooding on repeated cache write failures
const errorLogRateLimiter = new Map<string, number>();
const ERROR_LOG_INTERVAL_MS = 60_000;

function shouldLogError(errorKey: string): boolean {
  const now = Date.now();
  const lastLogged = errorLogRateLimiter.get(errorKey);

  if (!lastLogged || now - lastLogged > ERROR_LOG_INTERVAL_MS) {
    errorLogRateLimiter.set(errorKey, now);
    return true;
  }

  return false;
}

/**
 * PermissionCacheService manages database-backed permission caching.
 *
 * This service implements Tier 2 caching (database-backed) as part of
 * the hybrid caching strategy:
 * - Tier 1: In-memory LRU cache (10k entries, 60s TTL)
 * - Tier 2: Database cache (this service, 24h TTL default)
 * - Tier 3: Fresh computation from RBAC tables
 *
 * Performance Targets:
 * - Cache hit: <5ms (indexed lookup)
 * - Cache write: <3ms (single upsert)
 * - Invalidation: <10ms for user, <500ms for role
 * - Overall: 60%+ query reduction, 90%+ cache hit rate
 *
 * Responsibilities:
 * - Warm cache for users (pre-compute all permissions)
 * - Store/retrieve cached permission results
 * - Invalidate cache on user/role changes
 * - Cleanup expired cache entries
 *
 * @example
 * ```typescript
 * const cacheService = new PermissionCacheService(adapter, logger);
 *
 * // Pre-compute all permissions for a user
 * await cacheService.warmCacheForUser(userId);
 *
 * // Check cached permission
 * const cached = await cacheService.getCachedPermission(userId, 'read', 'users');
 * if (cached !== null) {
 *   return cached; // Cache hit
 * }
 *
 * // Invalidate on role change
 * await cacheService.invalidateByUser(userId);
 * ```
 */
export class PermissionCacheService extends BaseService {
  private permissionChecker: PermissionCheckerService;
  private cacheTtlMs: number;

  constructor(
    adapter: DrizzleAdapter,
    logger: Logger,
    options?: { cacheTtlSeconds?: number }
  ) {
    super(adapter, logger);

    this.permissionChecker = new PermissionCheckerService(adapter, logger);

    const ttlSeconds = options?.cacheTtlSeconds ?? 86400;
    this.cacheTtlMs = ttlSeconds * 1000;
  }

  /**
   * Pre-compute and store all permissions for a user (cache warming).
   *
   * This method is called on:
   * - User login
   * - Role assignment changes
   * - Permission changes affecting user's roles
   *
   * Performance: O(n) where n = number of possible permission checks (~20-50 typically)
   *
   * @param userId - User ID to warm cache for
   * @returns Promise that resolves when cache is warmed
   */
  async warmCacheForUser(userId: string): Promise<void> {
    if (!userId) {
      getAuthLogger()?.log?.("warn", {
        category: "auth",
        op: "cache",
        message: "warmCacheForUser called with empty userId",
      });
      return;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tables type does not expose userPermissionCache
      const { permissions, userPermissionCache } = this.tables as any;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allPermissions = (await (this.db as any)
        .select({
          id: permissions.id,
          action: permissions.action,
          resource: permissions.resource,
        })
        .from(permissions)) as Array<{
        id: string;
        action: string;
        resource: string;
      }>;

      if (allPermissions.length === 0) {
        return;
      }

      const roleIds =
        await this.permissionChecker.getAllPermissionsForRole(userId);

      const expiresAt = new Date(Date.now() + this.cacheTtlMs);
      const entries = [];

      for (const perm of allPermissions) {
        const hasPermission = roleIds.includes(perm.id);
        const cacheKey = `${userId}|${perm.action}|${perm.resource}`;

        entries.push({
          id: cacheKey,
          userId,
          action: perm.action,
          resource: perm.resource,
          hasPermission,
          roleIds: Array.from(roleIds),
          expiresAt,
          createdAt: new Date(),
        });
      }

      if (entries.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (this.db as any)
          .insert(userPermissionCache)
          .values(entries)
          .onConflictDoUpdate({
            target: userPermissionCache.id,
            set: {
              hasPermission: sql`EXCLUDED.has_permission`,
              roleIds: sql`EXCLUDED.role_ids`,
              expiresAt: sql`EXCLUDED.expires_at`,
              createdAt: sql`EXCLUDED.created_at`,
            },
          });
      }

      if (process.env.DEBUG_CACHE === "1") {
        console.log("[cache][dbg] warmCacheForUser", {
          userId,
          entriesCount: entries.length,
          ttlMs: this.cacheTtlMs,
        });
      }
    } catch (error) {
      getAuthLogger()?.log?.("error", {
        category: "auth",
        op: "cache",
        message: "warmCacheForUser failed",
        userId,
        error: String(error),
      });
      throw error;
    }
  }

  /**
   * Get cached permission result from database.
   *
   * Returns:
   * - `true` if permission is cached and granted
   * - `false` if permission is cached and denied
   * - `null` if cache miss (not cached or expired)
   *
   * Performance: <5ms (indexed lookup on composite key)
   *
   * @param userId - User ID
   * @param action - Permission action (create, read, update, delete)
   * @param resource - Permission resource (users, roles, permissions, etc.)
   * @returns Promise resolving to boolean if cached, null if miss
   */
  async getCachedPermission(
    userId: string,
    action: string,
    resource: string
  ): Promise<boolean | null> {
    if (!userId || !action || !resource) {
      return null;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tables type does not expose userPermissionCache
      const { userPermissionCache } = this.tables as any;
      const cacheKey = `${userId}|${action}|${resource}`;
      const now = new Date();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (this.db as any)
        .select({
          hasPermission: userPermissionCache.hasPermission,
          expiresAt: userPermissionCache.expiresAt,
        })
        .from(userPermissionCache)
        .where(
          and(
            eq(userPermissionCache.id, cacheKey),
            // gt() lets Drizzle convert `now` (Date) to the column's typed
            // representation (epoch seconds for SQLite mode:"timestamp",
            // native timestamp for PG/MySQL). Raw `sql\`${col} > ${now}\``
            // bypassed that conversion and SQLite drivers refused to bind
            // a Date object — `TypeError: SQLite3 can only bind numbers,
            // strings, bigints, buffers, and null` on every authed request.
            // Mirrors the same-file `cleanupExpired` pattern at line 481.
            gt(userPermissionCache.expiresAt, now)
          )
        )
        .limit(1);

      if (result.length === 0) {
        return null;
      }

      const cached = result[0] as { hasPermission: boolean; expiresAt: Date };

      if (process.env.DEBUG_CACHE === "1") {
        console.log("[cache][dbg] getCachedPermission HIT", {
          userId,
          action,
          resource,
          hasPermission: cached.hasPermission,
          expiresAt: cached.expiresAt,
        });
      }

      return cached.hasPermission;
    } catch (error) {
      getAuthLogger()?.log?.("error", {
        category: "auth",
        op: "cache",
        message: "getCachedPermission failed",
        userId,
        action,
        resource,
        error: String(error),
      });
      // Fail open on error
      return null;
    }
  }

  /**
   * Store permission result in database cache.
   *
   * Uses UPSERT (INSERT ON CONFLICT) to handle concurrent writes.
   *
   * Performance: <3ms (single indexed insert with ON CONFLICT)
   *
   * @param userId - User ID
   * @param action - Permission action
   * @param resource - Permission resource
   * @param hasPermission - Whether user has the permission
   * @param roleIds - Role IDs involved (for invalidation)
   * @returns Promise that resolves when cache is updated
   */
  async setCachedPermission(
    userId: string,
    action: string,
    resource: string,
    hasPermission: boolean,
    roleIds: string[]
  ): Promise<void> {
    if (!userId || !action || !resource) {
      return;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tables type does not expose userPermissionCache
      const { userPermissionCache } = this.tables as any;
      const cacheKey = `${userId}|${action}|${resource}`;
      const expiresAt = new Date(Date.now() + this.cacheTtlMs);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.db as any)
        .insert(userPermissionCache)
        .values({
          id: cacheKey,
          userId,
          action,
          resource,
          hasPermission,
          roleIds,
          expiresAt,
          createdAt: new Date(),
        })
        .onConflictDoUpdate({
          target: userPermissionCache.id,
          set: {
            hasPermission: sql`EXCLUDED.has_permission`,
            roleIds: sql`EXCLUDED.role_ids`,
            expiresAt: sql`EXCLUDED.expires_at`,
            createdAt: sql`EXCLUDED.created_at`,
          },
        });

      if (process.env.DEBUG_CACHE === "1") {
        console.log("[cache][dbg] setCachedPermission", {
          userId,
          action,
          resource,
          hasPermission,
          roleIds,
          expiresAt,
        });
      }
    } catch (error) {
      // Rate-limited error logging to prevent log flooding
      const errorKey = `setCachedPermission:${userId}`;
      if (shouldLogError(errorKey)) {
        getAuthLogger()?.log?.("error", {
          category: "auth",
          op: "cache",
          message:
            "setCachedPermission failed (rate-limited, showing 1/min max)",
          userId,
          action,
          resource,
          error: String(error),
        });
      }
      // Don't throw - cache write failures should not break permission checks
    }
  }

  /**
   * Invalidate all cached permissions for a user.
   *
   * Called on:
   * - Role assignment/removal
   * - User deactivation
   * - Manual cache clear
   *
   * Uses write-through invalidation (tombstone pattern) to prevent race conditions:
   * 1. Mark entries as expired (expiresAt = now) - creates tombstone
   * 2. Any concurrent reads will see expired entries and recompute
   * 3. Concurrent writes will overwrite tombstones with fresh data
   *
   * Performance: <10ms (indexed update by userId)
   *
   * @param userId - User ID to invalidate
   * @returns Promise resolving to number of entries invalidated
   */
  async invalidateByUser(userId: string): Promise<number> {
    if (!userId) {
      return 0;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tables type does not expose userPermissionCache
      const { userPermissionCache } = this.tables as any;

      // Write-through invalidation: mark as expired (tombstone) instead of deleting
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (this.db as any)
        .update(userPermissionCache)
        .set({ expiresAt: new Date() })
        .where(eq(userPermissionCache.userId, userId));

      const invalidatedCount = result.rowCount ?? 0;

      if (process.env.DEBUG_CACHE === "1") {
        console.log("[cache][dbg] invalidateByUser", {
          userId,
          invalidatedCount,
          method: "tombstone",
        });
      }

      return invalidatedCount;
    } catch (error) {
      getAuthLogger()?.log?.("error", {
        category: "auth",
        op: "cache",
        message: "invalidateByUser failed",
        userId,
        error: String(error),
      });
      return 0;
    }
  }

  /**
   * Invalidate cached permissions for all users with a specific role.
   *
   * Called on:
   * - Role permission changes
   * - Role deletion
   * - Permission changes
   *
   * Uses write-through invalidation (tombstone pattern) to prevent race conditions:
   * 1. Mark entries as expired (expiresAt = now) - creates tombstone
   * 2. Any concurrent reads will see expired entries and recompute
   * 3. Concurrent writes will overwrite tombstones with fresh data
   *
   * Uses JSONB contains operator to find affected users.
   *
   * Performance: O(n) where n = users with role (~10-500ms depending on data)
   *
   * @param roleId - Role ID to invalidate
   * @returns Promise resolving to number of entries invalidated
   */
  async invalidateByRole(roleId: string): Promise<number> {
    if (!roleId) {
      return 0;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tables type does not expose userPermissionCache
      const { userPermissionCache } = this.tables as any;

      // Write-through invalidation: mark as expired (tombstone) instead of deleting.
      // Prevents race conditions where a concurrent permission check might write
      // stale data after invalidation.
      //
      // Phase A follow-up (2026-05-01): the `@>` JSONB containment
      // operator is PostgreSQL-only — on SQLite it threw `SqliteError:
      // unrecognized token: "@"` on every authed request that triggered
      // role invalidation, on MySQL it would similarly fail.
      //
      // Per-dialect path:
      //   - PG     → JSONB `@>` (column type IS jsonb)
      //   - MySQL  → `JSON_CONTAINS(col, ?)`  (JSON column type)
      //   - SQLite → `EXISTS (SELECT 1 FROM json_each(col) WHERE value = ?)`
      //     using the JSON1 extension built into all modern SQLite (3.9+;
      //     F17 minimum is 3.38). roleIds is stored as JSON text on
      //     SQLite (`text("role_ids")`), so a plain LIKE-substring scan
      //     would risk false positives if role IDs share substrings.
      //     json_each gives us exact-match without that risk.
      const containsRoleClause =
        this.dialect === "postgresql"
          ? sql`${userPermissionCache.roleIds} @> ${JSON.stringify([roleId])}`
          : this.dialect === "mysql"
            ? sql`JSON_CONTAINS(${userPermissionCache.roleIds}, ${JSON.stringify(roleId)})`
            : sql`EXISTS (SELECT 1 FROM json_each(${userPermissionCache.roleIds}) WHERE value = ${roleId})`;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (this.db as any)
        .update(userPermissionCache)
        .set({ expiresAt: new Date() })
        .where(containsRoleClause);

      const invalidatedCount = result.rowCount ?? 0;

      if (process.env.DEBUG_CACHE === "1") {
        console.log("[cache][dbg] invalidateByRole", {
          roleId,
          invalidatedCount,
          method: "tombstone",
        });
      }

      return invalidatedCount;
    } catch (error) {
      getAuthLogger()?.log?.("error", {
        category: "auth",
        op: "cache",
        message: "invalidateByRole failed",
        roleId,
        error: String(error),
      });
      return 0;
    }
  }

  /**
   * Remove expired cache entries (background maintenance).
   *
   * Should run periodically via cron job (recommended: daily).
   *
   * Performance: <100ms for 10k entries, uses indexed scan on expiresAt
   *
   * @returns Promise resolving to number of entries deleted
   */
  async cleanupExpired(): Promise<number> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tables type does not expose userPermissionCache
      const { userPermissionCache } = this.tables as any;
      const now = new Date();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (this.db as any)
        .delete(userPermissionCache)
        .where(lt(userPermissionCache.expiresAt, now));

      const deletedCount = result.rowCount ?? 0;

      if (process.env.DEBUG_CACHE === "1" || deletedCount > 0) {
        console.log("[cache][info] cleanupExpired", {
          deletedCount,
          timestamp: now.toISOString(),
        });
      }

      return deletedCount;
    } catch (error) {
      getAuthLogger()?.log?.("error", {
        category: "auth",
        op: "cache",
        message: "cleanupExpired failed",
        error: String(error),
      });
      return 0;
    }
  }
}
