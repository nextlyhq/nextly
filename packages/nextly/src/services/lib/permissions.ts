import { AsyncLocalStorage } from "node:async_hooks";

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
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { and, eq, inArray, ne } from "drizzle-orm";

// Phase 4 note: use relative paths instead of TS path aliases.
// Vitest's vite-tsconfig-paths plugin sometimes fails to resolve
// these aliases when this module loads in certain test orders
// (e.g. first dispatcher-touched module in the run). Relative paths
// are deterministic.
import {
  answersHoldUntil,
  forgetRequestAccess,
  rememberForRequest,
} from "../../auth/access/request-memo";
import { getDialectTables } from "../../database/index";
import { container } from "../../di/container";
import { PermissionCacheService } from "../../domains/auth/services/permission-cache-service";
import { NextlyError } from "../../errors/nextly-error";
import { getAuthLogger } from "../../lib/logger";
import { consoleLogger } from "../../shared/types";
import type { Logger } from "../shared";

import {
  bumpEpoch,
  currentEpoch,
  duringRetirement,
  refreshEpoch,
  stampIsCurrent,
} from "./rbac-epoch";
import {
  cacheExpiry,
  roleAssignmentInForce,
  soonestExpiry,
  userRoleAssignmentsInForce,
  type ResolvedRoles,
} from "./role-assignments";

if (typeof window !== "undefined") {
  throw new Error(
    "[nextly] Direct API permissions module loaded in a browser context. " +
      "Direct API is server-only — import only from Server Components, " +
      "Route Handlers, or Server Actions, never from client components."
  );
}

function getDb(): unknown {
  const adapter = container.get<DrizzleAdapter>("adapter");
  return adapter.getDrizzle();
}

/**
 * A minimal structural view of the Drizzle query builder used by the RBAC reads
 * below. It exists so the pooled or transaction-bound executor can be typed for
 * the `select(...).from(...).where(...) / .innerJoin(...) / .limit(...)` chain
 * these queries use — instead of casting the executor to `any` — while staying
 * dialect-agnostic (the concrete builder differs per driver). Each chain awaits
 * to an array of rows; callers narrow a row to the columns they projected.
 */
type RbacRow = Record<string, unknown>;
interface RbacSelectChain extends Promise<RbacRow[]> {
  from(table: unknown): RbacSelectChain;
  innerJoin(table: unknown, on: unknown): RbacSelectChain;
  where(condition: unknown): RbacSelectChain;
  limit(count: number): RbacSelectChain;
}
interface RbacQueryExecutor {
  select(projection?: Record<string, unknown>): RbacSelectChain;
}

/**
 * Resolve the executor for an RBAC read as the typed query builder above:
 * the caller's transaction-bound instance when supplied, otherwise the pooled
 * connection. `getDrizzle()` is typed `unknown`, so the cast narrows that opaque
 * value to the exact chain surface used here (no `any`).
 */
function rbacQuery(executor?: unknown): RbacQueryExecutor {
  return (executor ?? getDb()) as RbacQueryExecutor;
}

function getAdapter(): DrizzleAdapter {
  return container.get<DrizzleAdapter>("adapter");
}

function getLogger(): Logger {
  return container.has("logger")
    ? container.get<Logger>("logger")
    : consoleLogger;
}

export type PermissionCheck = { action: string; resource: string };

// Environment configuration for cache
const CACHE_ENABLED =
  process.env.PERMISSION_CACHE_ENABLED !== "false" &&
  process.env.PERMISSION_CACHE_ENABLED !== "0";
/**
 * How long a stored permission answer may be served.
 *
 * This is the shared tier, so it is also the longest a revoked grant can
 * survive somewhere the revoking process cannot reach: every cache here is
 * retired by a counter held in memory, and a second instance neither sees that
 * counter move nor has one of its own to compare against. Until that signal is
 * stored alongside the rows, the TTL is the only bound on cross-instance
 * staleness, and a day is not a bound worth having for authorization.
 *
 * Five minutes matches the window an API key's copied grants already carry, so
 * the two tiers expire on the same order rather than one outliving the other by
 * a factor of three hundred. Raising it is safe once the revision is shared.
 */
const CACHE_TTL_SECONDS = parseInt(
  process.env.PERMISSION_CACHE_TTL_SECONDS || "300",
  10
);

// The configured dialect's tables, looked up on each use. Kept for the whole
// process, the first dialect's definitions answered for every later one, and
// a comparison against a timestamp column then bound the value the first
// dialect's column type expects: a role's expiry compared as SQLite's integer
// seconds on PostgreSQL. The lookup only picks one of three schema objects.
function getTablesLazy() {
  return getDialectTables();
}

/**
 * Store one decision in the SHARED tier, and take it back if the rows it came
 * from changed while the write was in flight.
 *
 * The write is deliberately not awaited: a check should not wait on a cache
 * fill to answer. That leaves a window, and this is the half that closes it.
 * An invalidation can tombstone the table while the upsert is outstanding, and
 * the upsert then lands BEHIND the tombstone carrying a fresh expiry — into the
 * tier that is shared between instances and lives longest, so it would outlive
 * every other copy of the same answer. Re-asking the revision afterwards and
 * retiring this user's rows when it has moved means either the invalidation
 * caught the row or this does.
 *
 * Stated once because it is one property of writing asynchronously, and a
 * per-branch copy is the one a later branch is written without. A grant and a
 * denial are equally wrong when they outlive their cause, so both come here.
 */
function storeSharedDecision(
  service: PermissionCacheService,
  decision: {
    userId: string;
    action: string;
    resource: string;
    allowed: boolean;
    roleIds: string[];
    resolvedUnder: string;
    /** When the roles it was computed from next change; see `resolveRoles`. */
    validUntil: number | undefined;
  }
): void {
  const {
    userId,
    action,
    resource,
    allowed,
    roleIds,
    resolvedUnder,
    validUntil,
  } = decision;
  void (async () => {
    try {
      await service.setCachedPermission(
        userId,
        action,
        resource,
        allowed,
        roleIds,
        validUntil
      );
      // Forced, not throttled. This is the one place the interval must not
      // apply: the window being closed is the upsert's own flight time, and a
      // revocation that landed inside it is by definition newer than the last
      // read. Asking the cached value here would accept the write the check
      // exists to catch.
      await refreshEpoch({ force: true });
      if (!resolvedUnderCurrentRevision(resolvedUnder)) {
        await service.invalidateByUser(userId);
      }
    } catch (error) {
      getAuthLogger()?.log?.("warn", {
        category: "auth",
        op: "cache",
        message: "DB cache write failed",
        userId,
        error: String(error),
      });
    }
  })();
}

class PermissionChecker {
  private memo = new Map<string, boolean>();
  private t: ReturnType<typeof getTablesLazy>;
  private cacheService: PermissionCacheService | null = null;

  // Whether the reads run on a database the caller brought, whose answers the
  // request's memo of the configured database must never serve.
  private readonly ownDatabase: boolean;

  constructor(dialect?: string) {
    // The tables of the dialect the reads run on: the caller's, when it reads
    // through a database of its own, whose dialect the process's setting need
    // not name; the configured one otherwise.
    this.t = dialect ? getDialectTables(dialect) : getTablesLazy();
    this.ownDatabase = dialect !== undefined;

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
    resource: string,
    // A transaction-bound Drizzle executor, supplied when the caller is already
    // inside a write transaction so the role/permission reads run on that
    // transaction's own connection instead of taking a second pooled one, which
    // can stall against a small pool while the caller's transaction holds one.
    // Defaults to the pooled connection when omitted.
    executor?: unknown
  ): Promise<boolean> {
    try {
      return await this.answerPermission(userId, action, resource, executor);
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

  /**
   * The decision behind {@link hasPermission}, which throws on a failed read
   * rather than answering `false`. A denial that only reflects a failure must
   * not be kept as the answer, by the request's memo or by any cache here.
   */
  async answerPermission(
    userId: string,
    action: string,
    resource: string,
    // Optional transaction-bound executor; see `hasPermission`.
    executor?: unknown
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
    // Captured before the reads below; see `resolvedUnderCurrentRevision`. Both
    // tiers written at the end of this method are subject to the same race, and
    // the database tier is the worse of the two: it is shared across instances
    // and its entries live longest, so a stale decision written after a
    // tombstone outlives everything else here.
    //
    // Refreshed first, so what is captured accounts for a change made by
    // ANOTHER instance. Rate-limited to one read a second, which is what makes
    // this affordable on a path taken by every request, and what bounds how
    // long this process can be unaware of somebody else's revocation.
    //
    // For a POOLED check only. The refresh is itself a pooled query, so issuing
    // it from inside a caller's still-open transaction asks the pool for a
    // second connection — and where the pool holds one connection, the caller's
    // transaction is holding it, so the query never runs and the check never
    // answers. It would also buy nothing: an executor-backed check is not
    // cacheable at any tier, so every use of `resolvedUnder` below is already
    // behind `!executor` and the value is never consulted.
    const resolvedUnder = executor ? currentEpoch() : await refreshEpoch();

    // Skip EVERY cache tier when a transaction executor is supplied. Such a check
    // reads through the caller's still-open (uncommitted) transaction, so its
    // result must be neither served from nor promoted into the process-wide
    // caches: if that transaction rolls back, a grant or denial that never
    // committed would otherwise be reused by later, non-transactional requests
    // for the cache TTL. An executor-backed check always computes fresh below.
    //
    // The stored tier is skipped for a second reason as well: its lookup is a
    // pooled query, so making it from inside the caller's transaction is the
    // same re-entry the epoch refresh above avoids.
    if (!executor) {
      const remembered = this.servedFromMemory(key, userId);
      if (typeof remembered === "boolean") return remembered;

      const stored = await this.servedFromSharedTier(
        key,
        { userId, action, resource },
        resolvedUnder
      );
      if (typeof stored === "boolean") return stored;
    }

    // Tier 3: Fresh computation (~10ms).
    return this.freshAnswer(
      key,
      { userId, action, resource },
      executor,
      resolvedUnder
    );
  }

  /**
   * Tier 3: the answer computed from the user's roles, filed in the cache
   * tiers when it may be. A failed read throws to the caller, so nothing here
   * keeps a denial that only reflects the failure.
   */
  private async freshAnswer(
    key: string,
    check: { userId: string; action: string; resource: string },
    executor: unknown,
    resolvedUnder: ReturnType<typeof currentEpoch>
  ): Promise<boolean> {
    const { userId, action, resource } = check;
    // With the moment the answer stops holding, so no tier below serves it
    // past the expiry of a role it was computed from.
    const { roleIds, validUntil } = await this.resolveRoles(userId, executor);

    if (roleIds.size === 0) {
      // Cache tiers are populated only for pooled (committed-view) checks; an
      // executor-backed result must not leak into them (see the skip at the
      // top of `answerPermission`). The DB write is also a pooled query the
      // transaction would block on. And not at all if these rows were
      // invalidated while the read ran.
      if (!executor && resolvedUnderCurrentRevision(resolvedUnder)) {
        this.memo.set(key, false);
        // A user with no roles is denied, and that denial is stored on the
        // same terms as an answer computed from roles: a first role granted
        // while the write is in flight would otherwise be outlived by a
        // stored `false`. A denial surviving its cause is as wrong as a
        // grant surviving its own.
        if (this.cacheService) {
          storeSharedDecision(this.cacheService, {
            userId,
            action,
            resource,
            allowed: false,
            roleIds: [],
            resolvedUnder,
            validUntil,
          });
        }
      }
      return false;
    }
    const allowed = await this.roleSetHasPermission(
      Array.from(roleIds),
      action,
      resource,
      executor
    );

    // Populate the cache tiers only for pooled checks. An executor-backed
    // result reflects the caller's uncommitted transaction and must not be
    // promoted into the process-wide caches (see the skip at the top of
    // `answerPermission`).
    const cacheable = !executor && resolvedUnderCurrentRevision(resolvedUnder);
    if (cacheable) {
      this.memo.set(key, allowed);
      setCacheEntry(key, allowed, userId, Array.from(roleIds), validUntil);
    }

    // Async write to DB cache (don't block response). Skipped under a
    // transaction executor for the same pooled-query reason as the read above.
    //
    // Checked again AFTER the upsert, not only before it. This write is not
    // awaited, so an invalidation can tombstone the table while it is still
    // in flight and the upsert then lands behind it with a fresh expiry —
    // into the tier that is shared between instances and lives for a day, so
    // it would outlast every other copy here. Tombstoning this user's rows
    // when that happens is the write-then-verify half: either the
    // invalidation caught the row, or this does.
    if (this.cacheService && cacheable) {
      storeSharedDecision(this.cacheService, {
        userId,
        action,
        resource,
        allowed,
        roleIds: Array.from(roleIds),
        resolvedUnder,
        validUntil,
      });
    }

    return allowed;
  }

  /**
   * Tiers 1 and 1b: the per-checker memo and the process-wide LRU.
   *
   * `undefined` means no answer, which is not the same as `false`: a denial is
   * cached on the same terms as a grant, so the two have to stay tellable
   * apart all the way back to the caller.
   */
  private servedFromMemory(key: string, userId: string): boolean | undefined {
    const memoed = this.memo.get(key);
    if (typeof memoed === "boolean") return memoed;

    const hit = cache.get(key);
    if (!hit) return undefined;

    if (servable(hit)) {
      // The entry ends at the expiry of a role it came from, and so does the
      // request's copy of it.
      answersHoldUntil(userId, hit.expiresAt);
      this.memo.set(key, hit.value);
      // refresh LRU by deleting+setting
      cache.delete(key);
      cache.set(key, hit);
      return hit.value;
    }

    forgetKey(key);
    return undefined;
  }

  /**
   * Tier 2: the stored row, promoted into tier 1 when it may still be trusted.
   *
   * `undefined` means no usable answer, for either reason: nothing stored, or
   * something stored that an invalidation has overtaken.
   */
  private async servedFromSharedTier(
    key: string,
    check: { userId: string; action: string; resource: string },
    resolvedUnder: string
  ): Promise<boolean | undefined> {
    if (!this.cacheService) return undefined;
    const { userId, action, resource } = check;

    try {
      const stored = await this.cacheService.getCachedDecision(
        userId,
        action,
        resource
      );
      // The lookup is itself awaited, so an invalidation can land while it
      // is outstanding: the row it returns was read before the change and
      // promoting it would put a retired decision back into tier 1 for that
      // tier's whole life, having just been tombstoned in tier 2. Recompute
      // instead, which is what a miss would have done anyway.
      //
      // NOT covered by a test, and said here rather than left to look like
      // coverage: `setCachedPermission` does not take effect under
      // `createTestNextly` — the table is created and a write followed by a
      // read returns null — so no test can reach this branch. The predicate
      // it uses is covered; this call site is not.
      if (stored === null || !resolvedUnderCurrentRevision(resolvedUnder)) {
        return undefined;
      }
      // Cache hit - promote to tier 1, ending no later than the stored row
      // does: the row may end early, at the expiry of a role it came from.
      this.memo.set(key, stored.allowed);
      setCacheEntry(key, stored.allowed, userId, [], stored.expiresAt);
      answersHoldUntil(userId, stored.expiresAt);
      return stored.allowed;
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
      return undefined;
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

  async getAllRoleIdsForUser(
    userId: string,
    // Optional transaction-bound executor; see `hasPermission`.
    executor?: unknown
  ): Promise<Set<string>> {
    return (await this.resolveRoles(userId, executor)).roleIds;
  }

  /**
   * The roles a user holds now, inherited ones included, and until when that
   * answer holds: the soonest expiry among the assignments it came from.
   * Inheritance adds no expiry of its own, so the direct assignments decide
   * it. Anything cached from these roles is served no longer than that.
   */
  async resolveRoles(
    userId: string,
    // Optional transaction-bound executor; see `hasPermission`.
    executor?: unknown
  ): Promise<ResolvedRoles> {
    // Walked once per request on the pool: every gate, rule context and field
    // rule of the request asks this of the same rows.
    if (executor !== undefined || this.ownDatabase) {
      return this.walkRoles(userId, executor);
    }
    return rememberForRequest(userId, "roles", async () => {
      const resolved = await this.walkRoles(userId);
      // Nothing the request keeps about this user outlives these roles.
      answersHoldUntil(userId, resolved.validUntil);
      return resolved;
    });
  }

  private async walkRoles(
    userId: string,
    executor?: unknown
  ): Promise<ResolvedRoles> {
    const { roleIds: direct, validUntil } = await this.getDirectRoleAssignments(
      userId,
      executor
    );
    if (direct.size === 0) return { roleIds: direct, validUntil };

    const all = new Set<string>(direct);
    const queue: string[] = Array.from(direct);
    const visited = new Set<string>(queue);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { roleInherits } = this.t as any;

    // Descendants only. A role holds the permissions of the roles it inherits
    // from, and those are recorded as its children: creating a role with base
    // role B writes `role_inherits(parentRoleId = theNewRole, childRoleId =
    // B)`. So the edge is directed, and following it upwards as well makes it
    // symmetric — every role reachable from the user's own would count, and a
    // base role would collect everything the roles built on top of it hold.
    // Matches RoleInheritanceService.listDescendantRoles, which the rest of
    // the RBAC services resolve through.
    while (queue.length > 0) {
      const batch = queue.splice(0, 50);

      const childRows = await rbacQuery(executor)
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
    return { roleIds: all, validUntil };
  }

  /**
   * The user's role assignments in force now, and the soonest expiry among
   * them. A lapsed assignment grants nothing, so it is left out here, where
   * every permission and super-admin decision starts.
   */
  private async getDirectRoleAssignments(
    userId: string,
    // Optional transaction-bound executor; see `hasPermission`.
    executor?: unknown
  ): Promise<ResolvedRoles> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { userRoles } = this.t as any;
    const rows = (await rbacQuery(executor)
      .select({ roleId: userRoles.roleId, expiresAt: userRoles.expiresAt })
      .from(userRoles)
      .where(
        userRoleAssignmentsInForce(userRoles, userId, new Date())
      )) as Array<{ roleId: string; expiresAt: Date | null }>;
    return {
      roleIds: new Set(rows.map(r => String(r.roleId))),
      validUntil: soonestExpiry(rows),
    };
  }

  private async roleSetHasPermission(
    roleIds: string[],
    action: string,
    resource: string,
    // Optional transaction-bound executor; see `hasPermission`.
    executor?: unknown
  ): Promise<boolean> {
    if (roleIds.length === 0) return false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { roles, rolePermissions, permissions } = this.t as any;

    // Super Admin bypass: any role with slug 'super-admin' grants all permissions.
    // A failed read throws: the caller fails closed without keeping the denial.
    const superAdmin = await rbacQuery(executor)
      .select({ id: roles.id })
      .from(roles)
      .where(and(inArray(roles.id, roleIds), eq(roles.slug, "super-admin")))
      .limit(1);
    if (superAdmin.length > 0) return true;

    // Step 1: resolve permission id by action+resource
    const perm = await rbacQuery(executor)
      .select({ id: permissions.id })
      .from(permissions)
      .where(
        and(eq(permissions.action, action), eq(permissions.resource, resource))
      )
      .limit(1);
    const permId = (perm[0]?.id ?? null) as string | null;
    if (!permId) return false;

    // Step 2: check existence of mapping for any of the roles
    const rows = await rbacQuery(executor)
      .select({ id: rolePermissions.id })
      .from(rolePermissions)
      .where(
        and(
          inArray(rolePermissions.roleId, roleIds),
          eq(rolePermissions.permissionId, permId)
        )
      )
      .limit(1);

    return rows.length > 0;
  }
}

// ---- Process-wide LRU cache with TTL ----
type CacheValue = { value: boolean; expiresAt: number; epoch: string };

/**
 * May this entry still be SERVED?
 *
 * Gating the write alone is not enough, and that is the half this was missing.
 * A write filed under the current epoch is correct at the moment it happens;
 * what retires it is the epoch moving afterwards, which is exactly the case a
 * change on ANOTHER instance produces — nothing local clears the entry, and
 * without this it is served until it expires.
 *
 * Asked in one place so the two tiers cannot answer differently, and so a third
 * one added later has somewhere obvious to ask.
 */
function servable(entry: { expiresAt: number; epoch: string }): boolean {
  // Derived rather than restated. Whether a stamp is still current is one
  // question with one answer, and the tiers that asked it separately did not
  // all remember that a stamp is only worth comparing while the epoch is
  // trustworthy.
  return stampIsCurrent(entry.epoch) && entry.expiresAt > Date.now();
}
const cacheTtlMs = 60_000; // 60 seconds
// Memory cache size: configurable via PERMISSION_CACHE_MEMORY_SIZE env var
const cacheMaxEntries =
  parseInt(process.env.PERMISSION_CACHE_MEMORY_SIZE ?? "10000", 10) || 10_000;
const cache = new Map<string, CacheValue>();
const keyToRoleIds = new Map<string, Set<string>>();
const roleIdToKeys = new Map<string, Set<string>>();
const userIdToKeys = new Map<string, Set<string>>();

/**
 * Drop one key and every index that points at it.
 *
 * Four callers evict a key for four different reasons — the entry expired, the
 * LRU is full, the user changed, the role changed — and every one of them has
 * to unpick the same three reverse maps. Written out per caller, an index left
 * behind holds a key nothing can reach: the next invalidation for that user or
 * role iterates a name that is no longer in the cache and skips the entry it
 * was raised to remove.
 */
function forgetKey(key: string): void {
  cache.delete(key);
  const roleIds = keyToRoleIds.get(key);
  keyToRoleIds.delete(key);
  if (roleIds) for (const rid of roleIds) roleIdToKeys.get(rid)?.delete(key);
  const owner = key.split("|", 1)[0];
  const owned = userIdToKeys.get(owner);
  owned?.delete(key);
  if (owned?.size === 0) userIdToKeys.delete(owner);
}

function setCacheEntry(
  key: string,
  value: boolean,
  userId: string,
  roleIds: string[],
  // When the answer stops holding, if sooner than the TTL: the soonest expiry
  // of a role it came from, or the expiry of the stored row it was promoted
  // from. Without it an entry outlived that expiry by up to a whole TTL.
  validUntil?: number
) {
  // simple eviction of oldest
  if (cache.size >= cacheMaxEntries) {
    const oldest = cache.keys().next().value;
    if (oldest) forgetKey(oldest);
  }
  cache.set(key, {
    value,
    expiresAt: cacheExpiry(Date.now(), cacheTtlMs, validUntil),
    epoch: currentEpoch(),
  });
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
  resource: string,
  // Optional transaction-bound executor so the reads run on the caller's
  // transaction connection instead of the pool; see the checker method above.
  executor?: unknown,
  // The dialect `executor` reads, when the caller holds its own database.
  // Absent, the process's configured dialect, which names the global one.
  dialect?: string
): Promise<boolean> {
  try {
    const checker = new PermissionChecker(dialect);
    // Asked once per request for each user, action and resource, on the pool.
    // The throwing answer is what is kept, and a failure fails closed here, so
    // a denial caused by a failed read is not the answer for the request.
    const ask = () =>
      checker.answerPermission(userId, action, resource, executor);
    if (executor !== undefined || dialect !== undefined) return await ask();
    return await rememberForRequest(
      userId,
      `permission\u0000${action}\u0000${resource}`,
      ask
    );
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

/**
 * The roles a user holds now, inherited ones included, and until when that
 * answer holds. For a cache built from a user's roles outside this module, an
 * API key's grants among them, which must end at the soonest expiry too.
 */
export async function resolveUserRoles(
  userId: string,
  executor?: unknown
): Promise<ResolvedRoles> {
  return new PermissionChecker().resolveRoles(userId, executor);
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
  userId: string,
  // Optional transaction-bound executor; see `hasPermission`.
  executor?: unknown
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
    // Looked up once per request on the pool, so the field rules on every row
    // of a list read one answer rather than each asking again.
    if (executor !== undefined) {
      return await loadEffectivePermissions(userId, executor);
    }
    return await rememberForRequest(userId, "permissions", () =>
      loadEffectivePermissions(userId)
    );
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

/** The lookup behind {@link listEffectivePermissions}; throws on a failed read. */
async function loadEffectivePermissions(
  userId: string,
  executor?: unknown
): Promise<string[]> {
  {
    const checker = new PermissionChecker();
    const roleIds = await checker.getAllRoleIdsForUser(userId, executor);

    if (roleIds.size === 0) {
      return [];
    }

    const t = getTablesLazy();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { rolePermissions, permissions } = t as any;

    // Join role_permissions with permissions to get all permissions for user's roles
    const rows = await rbacQuery(executor)
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
      consoleLogger.info("[permissions][dbg] listEffectivePermissions", {
        userId,
        roleCount: roleIds.size,
        permissionCount: result.length,
        permissions: result,
      });
    }

    return result;
  }
}

/**
 * How many times the RBAC rows behind every cache here have been invalidated.
 *
 * A DERIVED cache cannot be found from this module. An API key's grants are
 * resolved through these same rows and cached for five minutes of their own,
 * keyed by key id, in `domains/auth/services/api-key-service.ts`; that module
 * already imports this one, so it cannot be imported back without a cycle, and
 * this module has no way to learn which keys a role reaches.
 *
 * So the direction is reversed: this counts, and the deriver checks. An entry
 * resolved under an older count is not served, which retires every derived
 * cache on any role or user change without either module enumerating the
 * other's keys, and covers a path written later without it having to remember.
 *
 * Blunt on purpose. A role change is rare and re-resolving a key's grants is a
 * couple of indexed queries; a stale grant is the whole catalogue in the hands
 * of somebody who no longer holds the role that granted it.
 */
// Kept as a NAME rather than a variable. The count now lives in
// `rbac-epoch`, where every instance can read it; leaving a second copy here
// would be two answers to one question, and the local one would win every
// comparison it took part in.

/** The current count; see {@link invalidatePermissionCache}. */
export function rbacRevision(): string {
  return currentEpoch();
}

/**
 * May a result computed under `revision` still be CACHED?
 *
 * Every answer here is read asynchronously and stored afterwards, so an
 * invalidation can land in between: the rows were read under the old revision
 * and the write would file them under the new one, putting a decision the
 * change was meant to retire back into a cache that had just been cleared.
 *
 * Clearing the caches is therefore not enough on its own, and this is the other
 * half. Stated once and asked at every cache write rather than solved per
 * cache, because it is one property of reading asynchronously and caching the
 * result, and a per-cache answer is a list that the next cache is left off.
 *
 * The failing direction is a missed cache write, which costs one re-resolution.
 *
 * A retirement that is still running counts as not current, whatever the
 * numbers say. Clearing the shared tier is an awaited database write, and the
 * revision cannot be advanced once at the end to cover it: a check that starts
 * and finishes entirely inside that window reads a row the tombstone has not
 * reached yet, compares two numbers that have not moved since it captured one,
 * and promotes the retired answer into a tier that outlives the retirement.
 * Nothing is cacheable while the caches are being emptied.
 */
export function resolvedUnderCurrentRevision(revision: string): boolean {
  // Nothing of its own left. Whether a retirement is running was the one thing
  // this asked that `stampIsCurrent` did not, and asking it here meant the
  // caches that do not route through this predicate never asked it at all —
  // including a key's copied grants, in another module, which no list of maps
  // to empty was ever going to reach. It is one question, so it has one answer.
  return stampIsCurrent(revision);
}

/**
 * The super-admin answer, cached per user.
 *
 * Declared here rather than beside `isSuperAdmin` because
 * `invalidatePermissionCache` below has to clear it: it is the same question as
 * the permission caches above, asked of the same rows, and a cache that no
 * invalidation reaches is one that outlives the change it should have seen.
 */
const superAdminCache = new Map<
  string,
  { value: boolean; expiresAt: number; epoch: string }
>();
const SUPER_ADMIN_CACHE_TTL_MS = 60_000; // 60 seconds

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
/**
 * Retire EVERY cached permission answer, for a change that has no id to scope by.
 *
 * A permission ROW belongs to no user and no role: editing what a slug means, or
 * deleting it, changes what every role granting it confers and what the
 * catalogue contains. `invalidatePermissionCache` takes a `userId` or a
 * `roleId` and can express neither, so the permission service's own mutations
 * reached no cache at all — a role-based key kept a renamed slug and a
 * super-admin's key kept a deleted grant until their entries aged out.
 *
 * Clears the process-local tiers, tombstones the shared one, and advances the
 * revision so derived caches in this process retire with them.
 */
/**
 * The batch the CURRENT operation is part of, or nothing if it is not in one.
 *
 * Scoped to the async operation rather than counted for the process. A count is
 * shared by everything running at the time, so an unrelated revocation raised
 * while a seeder happened to be awaiting inside its own batch was read as a
 * nested write, deferred to the end of that batch, and left the revoked
 * permission authorizing requests for as long as the seeder took — for good, if
 * it stalled. Membership of a batch is a property of the work, and this is how
 * the runtime expresses that.
 */
const permissionSweep = new AsyncLocalStorage<{ dirty: boolean }>();

/**
 * Run a batch of permission-row writes under ONE table-wide invalidation.
 *
 * The database tier is tombstoned by an unfiltered update of every cached row,
 * which is the right cost once and the wrong cost per row: a seeder calls
 * `ensurePermission` once per permission, so a single new collection rewrote
 * and locked the whole cache table six times over, each after the first
 * already having expired everything the next one would find.
 *
 * Nested batches collapse into the outermost, and the flush happens on the way
 * out whether the batch succeeded or threw — a partial write still changed
 * rows, and leaving the caches holding answers derived from them is the one
 * outcome worse than doing the work twice.
 */
export async function inPermissionSweep<T>(run: () => Promise<T>): Promise<T> {
  // A batch already covering this operation absorbs it: the outer one flushes
  // on its way out and a second flush would only repeat the work.
  const enclosing = permissionSweep.getStore();
  if (enclosing) return run();

  const batch = { dirty: false };
  // Open for the batch's whole length, not from its first write. A batch exists
  // to write permission rows, and the alternative is a window between the run
  // starting and its first write in which answers derived from rows the batch
  // is about to change are still being filed as current.
  return duringRetirement(async () => {
    try {
      return await permissionSweep.run(batch, run);
    } finally {
      if (batch.dirty) await flushPermissionCaches();
    }
  });
}

/**
 * Empty the tiers this process holds in memory.
 *
 * Free, unlike the stored tier: no query, no lock, nothing to defer. So it
 * happens on every invalidation including the ones a batch defers the expensive
 * half of, and it is written once because four callers emptying five maps by
 * hand is four chances to forget the fifth.
 */
function clearInMemoryTiers(): void {
  cache.clear();
  keyToRoleIds.clear();
  roleIdToKeys.clear();
  userIdToKeys.clear();
  superAdminCache.clear();
}

export async function invalidateAllPermissionCaches(): Promise<void> {
  // This request wrote roles or permissions, so nothing it looked up stands.
  forgetRequestAccess();
  // Inside a sweep the caches are retired once, at the end. The revision still
  // advances immediately, so nothing in flight can file a result as current
  // while the batch is running — only the expensive table write is deferred.
  //
  // Deferred only for the batch's OWN writes. A revocation raised elsewhere
  // while a batch happens to be running is not part of it and retires the
  // caches now, however long the batch still has to run.
  const batch = permissionSweep.getStore();
  if (batch) {
    batch.dirty = true;
    // Retired here, announced at the exit. The tiers this process holds cost
    // nothing to empty, so an answer it is already holding does not outlive the
    // row it came from; what the batch defers is the unfiltered rewrite of
    // every STORED row, which is the cost it exists for.
    //
    // The epoch stays where it is until that rewrite has happened. Publishing
    // per write would tell every other instance to drop its in-memory answer
    // and read a stored row this batch has deliberately not tombstoned yet,
    // filing it under the new epoch where the batch's own exit cannot reach it
    // — and for as long as the batch runs, which for a seeder is not bounded by
    // anything this module controls.
    clearInMemoryTiers();
    return;
  }
  await flushPermissionCaches();
}

/**
 * Write permission ROWS, and retire what was copied from them.
 *
 * The table is reached through this rather than directly so that changing it
 * and retiring the answers derived from it are one act. A writer that carries
 * its own invalidation is a chance to omit one, and the omission is invisible
 * where it happens: a permission row belongs to no user and no role, so every
 * scoped invalidation is the wrong shape for it, and a writer's own tests
 * assert on rows rather than on what still answers from cache.
 *
 * The table arrives as an argument and comes back as the callback's parameter
 * so that a write is written inside the gate as a matter of course, and
 * `packages/nextly/src/domains/auth/services/__tests__/permission-writers-invalidate.test.ts`
 * holds every other write in the package to the same rule.
 *
 * Retirement follows the work whether it succeeded or threw: a statement that
 * failed partway still changed rows, and caches derived from them are the one
 * outcome worse than retiring answers that were fine. Where the write is inside
 * a transaction, wrap the TRANSACTION rather than the statement — retiring
 * before the commit invites a concurrent read to refill the caches from the
 * state being replaced.
 */
export async function writingPermissions<TTable, T>(
  permissions: TTable,
  run: (permissions: TTable) => Promise<T>
): Promise<T> {
  try {
    return await run(permissions);
  } finally {
    await invalidateAllPermissionCaches();
  }
}

/**
 * Empty the SHARED tier, then publish the epoch that retires everything else.
 *
 * That order is the invariant, not an implementation detail. The epoch is the
 * only signal another instance ever receives, and it is a one-way barrier: an
 * answer filed before it moves is retired by the move, an answer filed after it
 * is not.
 *
 * Publishing first therefore opens a window on every OTHER instance, and it is
 * the worst-shaped window here. That instance rejects its own in-memory answer
 * because the epoch moved, falls through to the stored row the tombstone has
 * not reached yet, and promotes that retired decision back into memory under
 * the NEW epoch — where nothing still to happen can reach it. Nothing local
 * defends against this: the depth below is one process's own, and the instance
 * doing the promoting is not the one invalidating.
 *
 * Emptying the stored rows first closes it from both sides. An instance that
 * has not yet seen the move promotes under the OLD epoch, and the move retires
 * that too; one that has seen the move finds nothing left to promote.
 *
 * The depth is held across both steps because THIS process has the same window
 * between the tombstone starting and the epoch being published; see
 * {@link resolvedUnderCurrentRevision}, which is where it is read.
 *
 * ## A retirement that failed publishes nothing
 *
 * The epoch means "everything filed before this is gone", and that sentence is
 * false about stored rows a failed tombstone left live. Publishing it anyway is
 * worse than staying quiet, not merely unhelpful: every other instance rejects
 * its own in-memory answer BECAUSE the epoch moved, falls through to a row that
 * is still there, and files it under the new epoch where nothing left to happen
 * can reach it. Announcing the retirement is what converts rows that would have
 * aged out into copies with a fresh life.
 *
 * Staying quiet leaves those rows served until their own expiry, which is what
 * the install had before any of this existed. The write still happened and the
 * failure is still reported; what is withheld is only the claim.
 */
async function retireSharedThenPublish(
  // Whatever the retirement answers is discarded: how many rows a tombstone
  // touched is not a signal anything here acts on, and a driver that reports it
  // differently must not become a branch. Whether it THREW is the signal.
  retireShared: () => Promise<unknown>,
  logContext: Record<string, unknown> = {}
): Promise<void> {
  return duringRetirement(async () => {
    if (CACHE_ENABLED) {
      try {
        await retireShared();
      } catch (error) {
        getAuthLogger()?.log?.("error", {
          category: "auth",
          op: "cache",
          message: "DB cache invalidation failed",
          ...logContext,
          error: String(error),
        });
        // Reported, not thrown: an invalidation failure must not break the
        // write that raised it. Unpublished, though, for the reason above.
        return;
      }
    }
    await bumpEpoch();
  });
}

async function flushPermissionCaches(): Promise<void> {
  clearInMemoryTiers();

  await retireSharedThenPublish(() =>
    new PermissionCacheService(getAdapter(), getLogger(), {
      cacheTtlSeconds: CACHE_TTL_SECONDS,
    }).invalidateAll()
  );
}

export async function invalidatePermissionCache(
  _hint: { userId?: string; roleId?: string } = {}
): Promise<void> {
  const { userId, roleId } = _hint || {};
  // This request changed someone's roles; nothing it looked up stands.
  forgetRequestAccess();

  // The super-admin answer is a cache of its own and has to go with them.
  //
  // It is the same question, asked of the same rows, and it was surviving a
  // role change for its full TTL: a user demoted out of super-admin kept the
  // session bypass for up to a minute. It reaches further than that now,
  // because an API key's grants are resolved through this answer and cached
  // for five minutes of their own, so a stale `true` could be copied into the
  // key's grants after the demotion and outlive it by both windows together.
  //
  // A `roleId` hint clears the whole map rather than a subset: the map does not
  // record which users a role reaches, the in-memory permission keys only name
  // users who happen to have a cached entry, and the map is bounded at 1,000
  // entries with a 60-second life. Re-asking is a single indexed query, and a
  // role change is rare; guessing at the subset is how a demotion survives.
  if (userId) superAdminCache.delete(userId);
  if (roleId) superAdminCache.clear();

  // Invalidate in-memory caches (Tier 1). Copied before iterating, because
  // dropping a key edits the very index being walked.
  if (userId) {
    for (const key of [...(userIdToKeys.get(userId) ?? [])]) forgetKey(key);
    userIdToKeys.delete(userId);
  }
  if (roleId) {
    for (const key of [...(roleIdToKeys.get(roleId) ?? [])]) forgetKey(key);
    roleIdToKeys.delete(roleId);
  }

  // Invalidate the database tier (Tier 2), and only then announce it. Same
  // ordering as `flushPermissionCaches`, for the reason stated on
  // `retireSharedThenPublish`: a scoped tombstone is still an awaited write, so
  // announcing first still lets another instance promote the row it is about to
  // remove into a place the removal cannot reach.
  await retireSharedThenPublish(
    async () => {
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
    },
    { userId, roleId }
  );
}

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
export async function isSuperAdmin(
  userId: string,
  // Optional transaction-bound executor so the role read runs on the caller's
  // transaction connection instead of the pool; see `hasPermission`. When
  // supplied, the process-wide super-admin cache is bypassed for both read and
  // write: the check reads through the caller's uncommitted transaction, so its
  // result must not be served from — nor promoted into — a cache shared with
  // later requests (a rolled-back transaction would otherwise poison it).
  executor?: unknown
): Promise<boolean> {
  if (!userId) return false;
  // Decided once per request on the pool. A failed decision is not kept, and
  // answers `false` as before.
  if (executor === undefined) {
    try {
      return await rememberForRequest(userId, "super-admin", () =>
        superAdminOnPool(userId)
      );
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
  return superAdminAnswer(userId, executor);
}

/** The pooled super-admin decision, served from the process cache when fresh. */
async function superAdminOnPool(userId: string): Promise<boolean> {
  // Before the reads below, never after. An invalidation landing while they are
  // in flight would otherwise be undone by the write at the end of
  // `decideSuperAdmin`, which repopulates the answer that was just cleared —
  // and a key's grants resolved from it would then be cached under the NEW
  // revision, putting the catalogue back for a full five minutes in the hands
  // of somebody who had just lost the role.
  //
  // Refreshed rather than read, for the reason `hasPermission` gives: a
  // demotion performed on another instance has to reach this one.
  const resolvedUnder = await refreshEpoch();
  const cached = superAdminCache.get(userId);
  if (cached && servable(cached)) {
    // The entry ends at the expiry of the role that gave it; so does the
    // request's copy.
    answersHoldUntil(userId, cached.expiresAt);
    return cached.value;
  }
  return decideSuperAdmin(userId, undefined, resolvedUnder);
}

/**
 * The super-admin answer for a check made through a transaction. The epoch is
 * read, not refreshed: the refresh is a pooled query, and the caller's
 * transaction may be holding the only connection there is. No cache is read or
 * written, since the answer reflects the transaction's uncommitted rows.
 */
async function superAdminAnswer(
  userId: string,
  executor: unknown
): Promise<boolean> {
  try {
    return await decideSuperAdmin(userId, executor, currentEpoch());
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
 * Whether a user holds `super-admin`, THROWING when the answer cannot be read.
 *
 * `isSuperAdmin` answers a failed read with `false`, which is the safe answer
 * for an ACCESS check — denying super-admin denies access. For a REFUSAL gate
 * — "refuse to create this account if it reaches super-admin" — the same
 * `false` means "allow", and on MySQL and SQLite a failed read does not abort
 * the surrounding transaction, so the account would commit. A gate asks this
 * one, and a read that fails fails the operation.
 *
 * The same decision as `isSuperAdmin`, not a second one: both run
 * `decideSuperAdmin`. Meant for an executor-backed check inside a
 * transaction, so neither the cache nor the pooled revision is consulted.
 */
export async function isSuperAdminOrThrow(
  userId: string,
  executor: unknown
): Promise<boolean> {
  if (!userId) return false;
  return decideSuperAdmin(userId, executor, currentEpoch());
}

/**
 * The super-admin decision itself: resolve the user's roles (inherited ones
 * included) and ask whether any is `super-admin`. Throws on a failed read;
 * each caller decides what a failure means.
 */
async function decideSuperAdmin(
  userId: string,
  executor: unknown,
  resolvedUnder: ReturnType<typeof currentEpoch>
): Promise<boolean> {
  const checker = new PermissionChecker();
  // With the moment the answer stops holding, so the cache below never
  // serves super-admin authority past the expiry of the role that gave it.
  const { roleIds, validUntil } = await checker.resolveRoles(userId, executor);

  // One decision, asked once: an executor-backed result reflects an
  // uncommitted transaction, and a result whose rows were invalidated while
  // this ran is already stale. Neither may be cached.
  const cacheable = () =>
    !executor && resolvedUnderCurrentRevision(resolvedUnder);

  if (roleIds.size === 0) {
    if (cacheable()) {
      superAdminCache.set(userId, {
        value: false,
        expiresAt: Date.now() + SUPER_ADMIN_CACHE_TTL_MS,
        epoch: currentEpoch(),
      });
    }
    return false;
  }

  const t = getTablesLazy();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { roles } = t as any;

  const superAdmin = await rbacQuery(executor)
    .select({ id: roles.id })
    .from(roles)
    .where(
      and(inArray(roles.id, Array.from(roleIds)), eq(roles.slug, "super-admin"))
    )
    .limit(1);

  const result = superAdmin.length > 0;

  // Populate the process-wide cache only for pooled checks; an executor-backed
  // result reflects the caller's uncommitted transaction (see the param note).
  // And only if nothing invalidated these rows while the reads were running.
  if (cacheable()) {
    superAdminCache.set(userId, {
      value: result,
      expiresAt: cacheExpiry(Date.now(), SUPER_ADMIN_CACHE_TTL_MS, validUntil),
      epoch: currentEpoch(),
    });

    // Evict oldest if cache grows too large
    if (superAdminCache.size > 1000) {
      const oldest = superAdminCache.keys().next().value;
      if (oldest) superAdminCache.delete(oldest);
    }
  }

  return result;
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

    const superAdminRoleId = superAdminRole[0]!.id;

    // Check if any other user holds the super-admin role. Held means in force
    // now: an expired assignment grants nothing, so it cannot be the one that
    // keeps the site administrable once this user's role is removed.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const otherSuperAdmins = await (getDb() as any)
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(
        and(
          eq(userRoles.roleId, superAdminRoleId),
          ne(userRoles.userId, excludeUserId),
          roleAssignmentInForce(userRoles, new Date())
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
export async function listRoleSlugsForUser(
  userId: string,
  // Optional transaction-bound executor; see `hasPermission`.
  executor?: unknown
): Promise<string[]> {
  try {
    return await listRoleSlugsForUserStrict(userId, executor);
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

/**
 * The strict lookup, refusing in the shape every caller can already read.
 *
 * Two places need a role set they can trust — the plugin facade and an API
 * key's own roles — and both need the refusal to arrive as a typed error
 * rather than as the driver's exception, because everything downstream of them
 * answers in the typed envelope and a raw database error carries no `code` to
 * branch on.
 *
 * Written once because it is one question. Asked separately, the two would
 * drift, and a caller left on the swallowing resolver is invisible: an empty
 * role set is a perfectly ordinary answer, so nothing downstream can tell it
 * from a lookup that failed.
 *
 * @throws NextlyError when the roles cannot be read.
 */
export async function listRoleSlugsForUserOrRefuse(
  userId: string,
  executor?: unknown
): Promise<string[]> {
  try {
    return await listRoleSlugsForUserStrict(userId, executor);
  } catch (cause) {
    throw NextlyError.internal({
      ...(cause instanceof Error ? { cause } : {}),
      logContext: { reason: "roles-unreadable", userId },
    });
  }
}

/**
 * The same lookup, where a failure to ASK is not an answer.
 *
 * `listRoleSlugsForUser` degrades a lookup error to an empty set, which is the
 * safe direction for a rule that grants on a role: no roles, no grant. It is
 * the WRONG direction for a rule that withholds on one — `!roles.includes(
 * "restricted")` passes for a caller whose roles could not be read — and for
 * any caller that must distinguish "this user holds no roles" from "the
 * database did not answer".
 *
 * So the swallowing version is derived from this one rather than the two being
 * written separately: they ask the identical question of the identical rows,
 * and differ only in what they do when the question cannot be asked. Written
 * twice, they would drift, and the drift would be invisible because both would
 * still look correct.
 *
 * @throws whatever the underlying query throws.
 */
export async function listRoleSlugsForUserStrict(
  userId: string,
  executor?: unknown
): Promise<string[]> {
  // An absent id names nobody rather than failing, matching the row-level
  // reading of an anonymous caller: there is no lookup to fail at.
  if (!userId) return [];
  // Looked up once per request on the pool; see `listEffectivePermissions`.
  if (executor !== undefined) return loadRoleSlugs(userId, executor);
  return rememberForRequest(userId, "role-slugs", () => loadRoleSlugs(userId));
}

/** The lookup behind {@link listRoleSlugsForUserStrict}; throws on failure. */
async function loadRoleSlugs(
  userId: string,
  executor?: unknown
): Promise<string[]> {
  const checker = new PermissionChecker();
  const roleIds = await checker.getAllRoleIdsForUser(userId, executor);

  if (roleIds.size === 0) return [];

  const t = getTablesLazy();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { roles } = t as any;

  const rows = await rbacQuery(executor)
    .select({ slug: roles.slug })
    .from(roles)
    .where(inArray(roles.id, Array.from(roleIds)));

  return (rows as Array<{ slug: string }>).map(r => r.slug);
}

/**
 * Resolve an authenticated caller's role SLUGS for access-rule evaluation.
 *
 * Session auth carries role IDs on the auth context, so they are resolved to
 * slugs; API-key auth already carries key-scoped slugs, so those are returned
 * as-is (no extra query). Shared by the REST route handler and the standalone
 * Single route so both forward slugs consistently.
 */
export function resolveRoleSlugs(auth: {
  userId: string;
  roles: string[];
  authMethod: "session" | "api-key";
}): Promise<string[]> {
  return auth.authMethod === "api-key"
    ? Promise.resolve(auth.roles)
    : listRoleSlugsForUser(auth.userId);
}
