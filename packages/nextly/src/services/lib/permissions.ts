// Hard runtime guard. The previous form was a try/catch'd dynamic
// `await import("server-only")` that silently allowed the module to
// load in client bundles. The audit recommended
// adding a static `import "server-only"` on top of the runtime
// check, but `server-only` always throws unless imported under
// React Server Components — including plain Node, which breaks
// nextly's package-level build-guard (which sanity-imports the root
// entry to confirm it loads). The runtime window check below catches
// the actual misuse path (a client component bundle that ends up
// running in a browser) without breaking server-side build/test.
// The verify-server-only.mjs CI script asserts the runtime throw.
import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import { and, eq, inArray, ne } from "drizzle-orm";

// Phase 4 note: use relative paths instead of TS path aliases.
// Vitest's vite-tsconfig-paths plugin sometimes fails to resolve
// these aliases when this module loads in certain test orders
// (e.g. first dispatcher-touched module in the run). Relative paths
// are deterministic.
import { getDialectTables } from "../../database/index";
import { getAuthLogger } from "../../lib/logger";

import { container } from "../../di/container";
import { PermissionCacheService } from "../auth/permission-cache-service";
import type { Logger } from "../shared";

if (typeof window !== "undefined") {
  throw new Error(
    "[nextly] Direct API permissions module loaded in a browser context. " +
      "Direct API is server-only — import only from Server Components, " +
      "Route Handlers, or Server Actions, never from client components."
  );
}

function getDb(): unknown {
  const adapter = container.get("adapter") as DrizzleAdapter;
  return adapter.getDrizzle();
}

function getAdapter(): DrizzleAdapter {
  return container.get("adapter") as DrizzleAdapter;
}

function getLogger(): Logger {
  return container.has("logger")
    ? (container.get("logger") as Logger)
    : (console as unknown as Logger);
}

export type PermissionCheck = { action: string; resource: string };

// Environment configuration for cache
const CACHE_ENABLED =
  process.env.PERMISSION_CACHE_ENABLED !== "false" &&
  process.env.PERMISSION_CACHE_ENABLED !== "0";
const CACHE_TTL_SECONDS = parseInt(
  process.env.PERMISSION_CACHE_TTL_SECONDS || "86400",
  10
);

// Lazy-load dialect tables to ensure correct tables are used
let _dialectTables: ReturnType<typeof getDialectTables> | null = null;
function getTablesLazy() {
  if (!_dialectTables) {
    _dialectTables = getDialectTables();
  }
  return _dialectTables;
}

class PermissionChecker {
  private memo = new Map<string, boolean>();
  private t = getTablesLazy();
  private cacheService: PermissionCacheService | null = null;

  constructor() {
    // Refresh tables reference in case it wasn't initialized yet
    this.t = getTablesLazy();

    // Initialize DB cache service if enabled
    if (CACHE_ENABLED) {
      try {
        this.cacheService = new PermissionCacheService(
          getAdapter(),
          getLogger(),
          {
            cacheTtlSeconds: CACHE_TTL_SECONDS,
          }
        );
      } catch (error) {
        getAuthLogger()?.log?.("warn", {
          category: "auth",
          op: "cache",
          message: "Failed to initialize PermissionCacheService",
          error: String(error),
        });
      }
    }
  }

  async hasPermission(
    userId: string,
    action: string,
    resource: string
  ): Promise<boolean> {
    if (!userId || !action || !resource) {
      getAuthLogger()?.log?.("debug", {
        category: "auth",
        op: "error",
        userId,
        action,
        resource,
      });
      return false;
    }

    const key = `${userId}|${action}|${resource}`;

    // Tier 1: In-memory instance cache (ultra-fast <1ms)
    const cached = this.memo.get(key);
    if (typeof cached === "boolean") return cached;

    // Tier 1b: Process-wide LRU cache (<1ms)
    const hit = cache.get(key);
    if (hit) {
      if (hit.expiresAt > Date.now()) {
        this.memo.set(key, hit.value);
        // refresh LRU by deleting+setting
        cache.delete(key);
        cache.set(key, hit);
        return hit.value;
      }
      // expired -> clear reverse maps
      cache.delete(key);
      const rids = keyToRoleIds.get(key);
      keyToRoleIds.delete(key);
      if (rids) for (const rid of rids) roleIdToKeys.get(rid)?.delete(key);
      userIdToKeys.get(userId)?.delete(key);
    }

    // Tier 2: Database cache (fast ~3-5ms)
    if (this.cacheService) {
      try {
        const dbCached = await this.cacheService.getCachedPermission(
          userId,
          action,
          resource
        );
        if (dbCached !== null) {
          // Cache hit - promote to tier 1
          this.memo.set(key, dbCached);
          setCacheEntry(key, dbCached, userId, []);
          return dbCached;
        }
      } catch (error) {
        // Log but don't fail - fall through to fresh computation
        getAuthLogger()?.log?.("warn", {
          category: "auth",
          op: "cache",
          message: "DB cache lookup failed, falling back to fresh computation",
          userId,
          action,
          resource,
          error: String(error),
        });
      }
    }

    // Tier 3: Fresh computation (~10ms)
    try {
      const roleIds = await this.getAllRoleIdsForUser(userId);

      if (roleIds.size === 0) {
        this.memo.set(key, false);
        // Store negative result in DB cache
        if (this.cacheService) {
          void this.cacheService.setCachedPermission(
            userId,
            action,
            resource,
            false,
            []
          );
        }
        return false;
      }
      const allowed = await this.roleSetHasPermission(
        Array.from(roleIds),
        action,
        resource
      );

      // Populate both cache tiers
      this.memo.set(key, allowed);
      setCacheEntry(key, allowed, userId, Array.from(roleIds));

      // Async write to DB cache (don't block response)
      if (this.cacheService) {
        void this.cacheService.setCachedPermission(
          userId,
          action,
          resource,
          allowed,
          Array.from(roleIds)
        );
      }

      return allowed;
    } catch {
      getAuthLogger()?.log?.("error", {
        category: "auth",
        op: "error",
        userId,
        action,
        resource,
      });
      return false; // fail-closed
    }
  }

  async hasAnyPermission(
    userId: string,
    checks: PermissionCheck[]
  ): Promise<boolean> {
    if (!userId || !Array.isArray(checks) || checks.length === 0) return false;
    for (const c of checks) {
      if (await this.hasPermission(userId, c.action, c.resource)) return true;
    }
    return false;
  }

  async hasAllPermissions(
    userId: string,
    checks: PermissionCheck[]
  ): Promise<boolean> {
    if (!userId || !Array.isArray(checks) || checks.length === 0) return false;
    for (const c of checks) {
      if (!(await this.hasPermission(userId, c.action, c.resource)))
        return false;
    }
    return true;
  }

  async getAllRoleIdsForUser(userId: string): Promise<Set<string>> {
    const direct = await this.getDirectRoleIds(userId);
    if (direct.size === 0) return direct;

    const all = new Set<string>(direct);
    const queue: string[] = Array.from(direct);
    const visited = new Set<string>(queue);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { roleInherits } = this.t as any;

    // Traverse both ancestors (parents) and descendants (children)
    while (queue.length > 0) {
      const batch = queue.splice(0, 50);

      // Fetch parent roles (ancestors)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parentRows = await (getDb() as any)
        .select({ parentRoleId: roleInherits.parentRoleId })
        .from(roleInherits)
        .where(inArray(roleInherits.childRoleId, batch));

      for (const r of parentRows as Array<{ parentRoleId: string }>) {
        const parentRoleId = String(r.parentRoleId);
        if (!visited.has(parentRoleId)) {
          visited.add(parentRoleId);
          all.add(parentRoleId);
          queue.push(parentRoleId);
        }
      }

      // Fetch child roles (descendants)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const childRows = await (getDb() as any)
        .select({ childRoleId: roleInherits.childRoleId })
        .from(roleInherits)
        .where(inArray(roleInherits.parentRoleId, batch));

      for (const r of childRows as Array<{ childRoleId: string }>) {
        const childRoleId = String(r.childRoleId);
        if (!visited.has(childRoleId)) {
          visited.add(childRoleId);
          all.add(childRoleId);
          queue.push(childRoleId);
        }
      }

      if (visited.size > 2000) {
        getAuthLogger()?.log?.("warn", {
          category: "auth",
          op: "error",
          userId,
        });
        break;
      }
    }
    return all;
  }

  private async getDirectRoleIds(userId: string): Promise<Set<string>> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { userRoles } = this.t as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await (getDb() as any)
      .select({ roleId: userRoles.roleId })
      .from(userRoles)
      .where(eq(userRoles.userId, userId));
    return new Set(
      (rows as Array<{ roleId: string }>).map(r => String(r.roleId))
    );
  }

  private async roleSetHasPermission(
    roleIds: string[],
    action: string,
    resource: string
  ): Promise<boolean> {
    if (roleIds.length === 0) return false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { roles, rolePermissions, permissions } = this.t as any;

    // Super Admin bypass: any role with slug 'super-admin' grants all permissions
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const superAdmin = await (getDb() as any)
        .select({ id: roles.id })
        .from(roles)
        .where(and(inArray(roles.id, roleIds), eq(roles.slug, "super-admin")))
        .limit(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((superAdmin as any[]).length > 0) return true;

      // Step 1: resolve permission id by action+resource
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const perm = await (getDb() as any)
        .select({ id: permissions.id })
        .from(permissions)
        .where(
          and(
            eq(permissions.action, action),
            eq(permissions.resource, resource)
          )
        )
        .limit(1);
      const permId = (perm?.[0]?.id ?? null) as string | null;
      if (!permId) return false;

      // Step 2: check existence of mapping for any of the roles
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = await (getDb() as any)
        .select({ id: rolePermissions.id })
        .from(rolePermissions)
        .where(
          and(
            inArray(rolePermissions.roleId, roleIds),
            eq(rolePermissions.permissionId, permId)
          )
        )
        .limit(1);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (rows as any[]).length > 0;
    } catch {
      return false;
    }
  }
}

// ---- Process-wide LRU cache with TTL ----
type CacheValue = { value: boolean; expiresAt: number };
const cacheTtlMs = 60_000; // 60 seconds
// Memory cache size: configurable via PERMISSION_CACHE_MEMORY_SIZE env var
const cacheMaxEntries =
  parseInt(process.env.PERMISSION_CACHE_MEMORY_SIZE ?? "10000", 10) || 10_000;
const cache = new Map<string, CacheValue>();
const keyToRoleIds = new Map<string, Set<string>>();
const roleIdToKeys = new Map<string, Set<string>>();
const userIdToKeys = new Map<string, Set<string>>();

function setCacheEntry(
  key: string,
  value: boolean,
  userId: string,
  roleIds: string[]
) {
  // simple eviction of oldest
  if (cache.size >= cacheMaxEntries) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest) {
      cache.delete(oldest);
      const rids = keyToRoleIds.get(oldest);
      keyToRoleIds.delete(oldest);
      if (rids) for (const rid of rids) roleIdToKeys.get(rid)?.delete(oldest);
      const u = oldest.split("|", 1)[0]!;
      userIdToKeys.get(u)?.delete(oldest);
      if (userIdToKeys.get(u)?.size === 0) userIdToKeys.delete(u);
    }
  }
  cache.set(key, { value, expiresAt: Date.now() + cacheTtlMs });
  const roleSet = new Set(roleIds);
  keyToRoleIds.set(key, roleSet);
  for (const rid of roleSet) {
    if (!roleIdToKeys.has(rid)) roleIdToKeys.set(rid, new Set());
    roleIdToKeys.get(rid)!.add(key);
  }
  if (!userIdToKeys.has(userId)) userIdToKeys.set(userId, new Set());
  userIdToKeys.get(userId)!.add(key);
}

export async function hasPermission(
  userId: string,
  action: string,
  resource: string
): Promise<boolean> {
  try {
    const checker = new PermissionChecker();
    return await checker.hasPermission(userId, action, resource);
  } catch {
    getAuthLogger()?.log?.("error", {
      category: "auth",
      op: "error",
      userId,
      action,
      resource,
    });
    return false;
  }
}

export async function hasAnyPermission(
  userId: string,
  checks: PermissionCheck[]
): Promise<boolean> {
  try {
    const checker = new PermissionChecker();
    return await checker.hasAnyPermission(userId, checks);
  } catch {
    getAuthLogger()?.log?.("error", { category: "auth", op: "error", userId });
    return false;
  }
}

export async function hasAllPermissions(
  userId: string,
  checks: PermissionCheck[]
): Promise<boolean> {
  try {
    const checker = new PermissionChecker();
    return await checker.hasAllPermissions(userId, checks);
  } catch {
    getAuthLogger()?.log?.("error", { category: "auth", op: "error", userId });
    return false;
  }
}

/**
 * Lists all effective permissions for a user by resolving role assignments and inheritance.
 * Returns permissions in the format '<resource>:<action>' (e.g., 'users:read', 'content:create').
 *
 * This function replaces static role-to-permission mappings with dynamic RBAC resolution.
 * Uses existing caching and database query optimization.
 */
export async function listEffectivePermissions(
  userId: string
): Promise<string[]> {
  if (!userId) {
    getAuthLogger()?.log?.("debug", {
      category: "auth",
      op: "permissions",
      error: "missing userId",
    });
    return [];
  }

  try {
    const checker = new PermissionChecker();
    const roleIds = await checker.getAllRoleIdsForUser(userId);

    if (roleIds.size === 0) {
      return [];
    }

    const t = getTablesLazy();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { rolePermissions, permissions } = t as any;

    // Join role_permissions with permissions to get all permissions for user's roles
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await (getDb() as any)
      .select({
        action: permissions.action,
        resource: permissions.resource,
      })
      .from(rolePermissions)
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(inArray(rolePermissions.roleId, Array.from(roleIds)));

    // Build permission strings and deduplicate
    const permissionStrings = new Set<string>();
    for (const row of rows as Array<{ action: string; resource: string }>) {
      permissionStrings.add(`${row.resource}:${row.action}`);
    }

    const result = Array.from(permissionStrings).sort();

    if (process.env.DEBUG_RBAC === "1") {
      console.log("[permissions][dbg] listEffectivePermissions", {
        userId,
        roleCount: roleIds.size,
        permissionCount: result.length,
        permissions: result,
      });
    }

    return result;
  } catch (error) {
    getAuthLogger()?.log?.("error", {
      category: "auth",
      op: "permissions",
      userId,
      error: String(error),
    });
    return []; // fail-closed
  }
}

/**
 * Invalidate permission cache (both in-memory and database tiers).
 *
 * This function clears cached permissions when user roles or role permissions change.
 *
 * @param hint - Invalidation hint with userId or roleId
 * @param hint.userId - Invalidate all permissions for this user
 * @param hint.roleId - Invalidate all permissions for users with this role
 *
 * @example
 * ```typescript
 * // After changing a user's roles
 * invalidatePermissionCache({ userId: '123' });
 *
 * // After changing a role's permissions
 * invalidatePermissionCache({ roleId: 'admin-role-id' });
 * ```
 */
export async function invalidatePermissionCache(
  _hint: { userId?: string; roleId?: string } = {}
): Promise<void> {
  const { userId, roleId } = _hint || {};

  // Invalidate in-memory caches (Tier 1)
  if (userId) {
    const keys = userIdToKeys.get(userId);
    if (keys) {
      for (const k of keys) {
        cache.delete(k);
        const rids = keyToRoleIds.get(k);
        keyToRoleIds.delete(k);
        if (rids) for (const rid of rids) roleIdToKeys.get(rid)?.delete(k);
      }
      userIdToKeys.delete(userId);
    }
  }
  if (roleId) {
    const keys = roleIdToKeys.get(roleId);
    if (keys) {
      for (const k of keys) {
        cache.delete(k);
        const rids = keyToRoleIds.get(k);
        keyToRoleIds.delete(k);
        if (rids) for (const rid of rids) roleIdToKeys.get(rid)?.delete(k);
        const uid = k.split("|", 1)[0]!;
        userIdToKeys.get(uid)?.delete(k);
        if (userIdToKeys.get(uid)?.size === 0) userIdToKeys.delete(uid);
      }
      roleIdToKeys.delete(roleId);
    }
  }

  // Invalidate database cache (Tier 2)
  if (CACHE_ENABLED) {
    try {
      const cacheService = new PermissionCacheService(
        getAdapter(),
        getLogger(),
        {
          cacheTtlSeconds: CACHE_TTL_SECONDS,
        }
      );

      if (userId) {
        await cacheService.invalidateByUser(userId);
      }
      if (roleId) {
        await cacheService.invalidateByRole(roleId);
      }
    } catch (error) {
      getAuthLogger()?.log?.("error", {
        category: "auth",
        op: "cache",
        message: "DB cache invalidation failed",
        userId,
        roleId,
        error: String(error),
      });
      // Don't throw - cache invalidation failures should not break operations
    }
  }
}

// ---- Super-admin check with caching ----
const superAdminCache = new Map<
  string,
  { value: boolean; expiresAt: number }
>();
const SUPER_ADMIN_CACHE_TTL_MS = 60_000; // 60 seconds

/**
 * Check if a user has the super-admin role.
 *
 * Resolves the user's full role set (direct + inherited) and checks
 * if any role has the `super-admin` slug. Results are cached in-memory
 * for 60 seconds.
 *
 * @param userId - The user ID to check
 * @returns `true` if the user has the super-admin role
 *
 * @example
 * ```typescript
 * if (await isSuperAdmin(userId)) {
 *   // Bypass all access checks
 * }
 * ```
 */
export async function isSuperAdmin(userId: string): Promise<boolean> {
  if (!userId) return false;

  // Check in-memory cache
  const cached = superAdminCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  try {
    const checker = new PermissionChecker();
    const roleIds = await checker.getAllRoleIdsForUser(userId);

    if (roleIds.size === 0) {
      superAdminCache.set(userId, {
        value: false,
        expiresAt: Date.now() + SUPER_ADMIN_CACHE_TTL_MS,
      });
      return false;
    }

    const t = getTablesLazy();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { roles } = t as any;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const superAdmin = await (getDb() as any)
      .select({ id: roles.id })
      .from(roles)
      .where(
        and(
          inArray(roles.id, Array.from(roleIds)),
          eq(roles.slug, "super-admin")
        )
      )
      .limit(1);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (superAdmin as any[]).length > 0;

    superAdminCache.set(userId, {
      value: result,
      expiresAt: Date.now() + SUPER_ADMIN_CACHE_TTL_MS,
    });

    // Evict oldest if cache grows too large
    if (superAdminCache.size > 1000) {
      const oldest = superAdminCache.keys().next().value as string | undefined;
      if (oldest) superAdminCache.delete(oldest);
    }

    return result;
  } catch (error) {
    getAuthLogger()?.log?.("error", {
      category: "auth",
      op: "permissions",
      userId,
      error: String(error),
    });
    return false; // fail-closed
  }
}

/**
 * Check if any user OTHER than the given userId has the super-admin role.
 *
 * Used for last-super-admin removal protection: prevents stripping the
 * super_admin role from a user if they are the only super-admin in the system.
 *
 * @param excludeUserId - The user ID to exclude from the check
 * @returns `true` if at least one other user has the super-admin role
 */
export async function hasSuperAdminExcluding(
  excludeUserId: string
): Promise<boolean> {
  if (!excludeUserId) return false;

  try {
    const t = getTablesLazy();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { roles, userRoles } = t as any;

    // Find the super-admin role ID
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const superAdminRole = await (getDb() as any)
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.slug, "super-admin"))
      .limit(1);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((superAdminRole as any[]).length === 0) return false;

    const superAdminRoleId = (superAdminRole as Array<{ id: string }>)[0]!.id;

    // Check if any other user holds the super-admin role
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const otherSuperAdmins = await (getDb() as any)
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(
        and(
          eq(userRoles.roleId, superAdminRoleId),
          ne(userRoles.userId, excludeUserId)
        )
      )
      .limit(1);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (otherSuperAdmins as any[]).length > 0;
  } catch {
    // fail-open: don't block operations if check fails
    return true;
  }
}

/**
 * Check if any of the given role IDs belongs to the super-admin role.
 *
 * Used for role-assignment protection: prevents non-super-admins from
 * assigning the super_admin role to any user via create/update user or
 * individual role-assignment endpoints.
 *
 * @param roleIds - Array of role IDs to check
 * @returns `true` if any role ID has the slug `super-admin`
 */
export async function containsSuperAdminRole(
  roleIds: string[]
): Promise<boolean> {
  if (!roleIds || roleIds.length === 0) return false;

  try {
    const t = getTablesLazy();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { roles } = t as any;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await (getDb() as any)
      .select({ id: roles.id })
      .from(roles)
      .where(and(inArray(roles.id, roleIds), eq(roles.slug, "super-admin")))
      .limit(1);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (rows as any[]).length > 0;
  } catch {
    // fail-open: don't break normal flow if we can't check
    return false;
  }
}

/**
 * Get role slugs for a user by resolving role IDs to slugs.
 *
 * Used by the RBAC AccessControlService to build context for code-defined
 * access functions that need role slug information.
 *
 * @param userId - The user ID
 * @returns Array of role slugs (e.g., ['super-admin', 'editor'])
 */
export async function listRoleSlugsForUser(userId: string): Promise<string[]> {
  if (!userId) return [];

  try {
    const checker = new PermissionChecker();
    const roleIds = await checker.getAllRoleIdsForUser(userId);

    if (roleIds.size === 0) return [];

    const t = getTablesLazy();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { roles } = t as any;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await (getDb() as any)
      .select({ slug: roles.slug })
      .from(roles)
      .where(inArray(roles.id, Array.from(roleIds)));

    return (rows as Array<{ slug: string }>).map(r => r.slug);
  } catch (error) {
    getAuthLogger()?.log?.("error", {
      category: "auth",
      op: "permissions",
      userId,
      error: String(error),
    });
    return [];
  }
}
