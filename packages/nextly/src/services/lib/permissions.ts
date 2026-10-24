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
import type { GrantedPermission } from "../../auth/authenticated-scope";
import { isDatabaseBusy } from "../../database/errors";
import { getDialectTables } from "../../database/index";
import { container } from "../../di/container";
import { NextlyError } from "../../errors/nextly-error";
import { emptyRetiredPermissionAnswers } from "../../init/retired-permission-answers";
import { getAuthLogger } from "../../lib/logger";
import { consoleLogger } from "../../shared/types";

import {
  bumpEpoch,
  duringRetirement,
  publishedEpoch,
  refreshEpoch,
  retireHereOnly,
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

export type PermissionCheck = { action: string; resource: string };

// The configured dialect's tables, looked up on each use. Kept for the whole
// process, the first dialect's definitions answered for every later one, and
// a comparison against a timestamp column then bound the value the first
// dialect's column type expects: a role's expiry compared as SQLite's integer
// seconds on PostgreSQL. The lookup only picks one of three schema objects.
function getTablesLazy() {
  return getDialectTables();
}

class PermissionChecker {
  private t: ReturnType<typeof getTablesLazy>;

  // Whether the reads run on a database the caller brought, whose answers the
  // request's memo of the configured database must never serve.
  private readonly ownDatabase: boolean;

  constructor(dialect?: string) {
    // The tables of the dialect the reads run on: the caller's, when it reads
    // through a database of its own, whose dialect the process's setting need
    // not name; the configured one otherwise.
    this.t = dialect ? getDialectTables(dialect) : getTablesLazy();
    this.ownDatabase = dialect !== undefined;
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
   * rather than answering `false`, computed from the user's roles as they are
   * read now. Asked only through a transaction or a database of the caller's
   * own: a pooled check is answered from the user's resolved actor instead
   * (see `heldThisRequest`), so this keeps nothing between calls.
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
    const { roleIds } = await this.resolveRoles(userId, executor);
    if (roleIds.size === 0) return false;
    return this.roleSetHasPermission(
      Array.from(roleIds),
      action,
      resource,
      executor
    );
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
    if (executor !== undefined || this.ownDatabase) {
      return this.walkRoles(userId, executor);
    }
    // On the pool, the roles of the user's resolved actor: walked once and
    // kept as long as the role version stands (see `actorThisRequest`).
    let actor: ResolvedActor;
    try {
      actor = await actorThisRequest(userId);
    } catch {
      // Walked on their own when the actor cannot be read whole: a reader
      // that needs only the roles, such as a key deciding whether its owner
      // is a super-admin, does not fail on a grants read it never needed.
      return this.walkRoles(userId);
    }
    // A set of its own for each caller, as a walk gave before.
    return { roleIds: new Set(actor.roleIds), validUntil: actor.validUntil };
  }

  /** The user's roles read now, with nothing kept. Throws on a failed read. */
  async walkRoles(userId: string, executor?: unknown): Promise<ResolvedRoles> {
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

// ---- The resolved actor, kept between requests ----

/**
 * A user's access as every pooled check reads it: the roles they hold now,
 * inherited ones included, those roles' slugs, the permissions they grant,
 * and whether one of them is `super-admin`.
 *
 * One resolution answers every question about the user, so the cache below
 * keeps the actor and never an answer: a question first asked after the
 * actor was kept is answered from it rather than read again.
 */
interface ResolvedActor {
  readonly roleIds: ReadonlySet<string>;
  readonly roleSlugs: readonly string[];
  readonly grants: readonly GrantedPermission[];
  readonly superAdmin: boolean;
  /** When the roles it came from next change; see `resolveRoles`. */
  readonly validUntil: number | undefined;
}

interface KeptActor {
  readonly actor: ResolvedActor;
  /** The role version it was resolved under. */
  readonly epoch: string;
  readonly expiresAt: number;
}

/**
 * How long a kept actor may be served when nothing retires it sooner.
 *
 * The role version retires it on any change, in this process or another, and
 * the soonest assignment expiry ends it earlier still. This is the backstop,
 * and what bounds how long a change made through another instance goes unseen
 * where the role version cannot be read: the same minute the per-answer
 * process cache it replaced carried.
 */
const ACTOR_CACHE_TTL_MS = 60_000;

/** The most users whose actors are kept at once, oldest-asked evicted first. */
const ACTOR_CACHE_MAX_ENTRIES = 10_000;

const actorCache = new Map<string, KeptActor>();

/**
 * The user's actor, read now with nothing kept: one walk of their roles, then
 * those roles' slugs and grants. Throws on a failed read.
 */
async function loadActor(userId: string): Promise<ResolvedActor> {
  const { roleIds, validUntil } = await new PermissionChecker().walkRoles(
    userId
  );
  if (roleIds.size === 0) {
    return {
      roleIds,
      roleSlugs: [],
      grants: [],
      superAdmin: false,
      validUntil,
    };
  }
  const [roleSlugs, grants] = await Promise.all([
    roleSlugsOf(roleIds),
    grantsOf(userId, roleIds),
  ]);
  return {
    roleIds,
    roleSlugs,
    grants,
    superAdmin: holdsSuperAdmin(roleSlugs),
    validUntil,
  };
}

/**
 * The user's actor on the pool: the one this process kept, while the role
 * version it was resolved under stands and before it expires, and otherwise
 * read now and kept.
 *
 * The role version is refreshed first, so a change made through another
 * instance retires what this one kept; the refresh reads it at most once a
 * second. An actor resolved while the version moved is not kept, since it may
 * be built from rows the change replaced.
 */
async function actorOnPool(userId: string): Promise<ResolvedActor> {
  warnRetiredPermissionCacheSettings();
  const resolvedUnder = await refreshEpoch();
  const kept = actorCache.get(userId);
  if (kept) {
    actorCache.delete(userId);
    if (stampIsCurrent(kept.epoch) && kept.expiresAt > Date.now()) {
      // Most recently asked last, so the oldest-asked goes first when full.
      actorCache.set(userId, kept);
      answersHoldUntil(userId, kept.expiresAt);
      return kept.actor;
    }
  }
  const actor = await loadActor(userId);
  const expiresAt = cacheExpiry(
    Date.now(),
    ACTOR_CACHE_TTL_MS,
    actor.validUntil
  );
  // Nothing the request keeps about this user outlives what this process
  // would keep: these roles, and the kept actor's own life.
  answersHoldUntil(userId, expiresAt);
  if (stampIsCurrent(resolvedUnder)) {
    if (actorCache.size >= ACTOR_CACHE_MAX_ENTRIES) {
      const oldest = actorCache.keys().next().value;
      if (oldest !== undefined) actorCache.delete(oldest);
    }
    actorCache.set(userId, {
      actor,
      epoch: resolvedUnder,
      expiresAt,
    });
  }
  return actor;
}

/**
 * The user's actor for this request: resolved once per request on the pool,
 * however many questions the request asks about the user.
 */
function actorThisRequest(userId: string): Promise<ResolvedActor> {
  return keptForRequest(userId, "actor", () => actorOnPool(userId));
}

/**
 * The settings of the per-answer caches the actor cache replaced. They no
 * longer change anything, so an install still setting one is told once.
 */
const RETIRED_PERMISSION_CACHE_SETTINGS = [
  "PERMISSION_CACHE_ENABLED",
  "PERMISSION_CACHE_TTL_SECONDS",
  "PERMISSION_CACHE_MEMORY_SIZE",
] as const;

let retiredSettingsWarned = false;

function warnRetiredPermissionCacheSettings(): void {
  if (retiredSettingsWarned) return;
  retiredSettingsWarned = true;
  const set = RETIRED_PERMISSION_CACHE_SETTINGS.filter(
    name => process.env[name] !== undefined
  );
  if (set.length === 0) return;
  consoleLogger.warn(
    `${set.join(", ")} no longer change how access is cached: a user's roles and permissions ` +
      "are read once and kept until a role or permission changes. " +
      (set.includes("PERMISSION_CACHE_ENABLED")
        ? "PERMISSION_CACHE_ENABLED=false still says no instance reads stored permission answers, " +
          "so they are not emptied when access changes. "
        : "") +
      "These settings are removed in a later release."
  );
}

/**
 * `load`, kept for the request (see `auth/access/request-memo`) under the
 * revision of the role and permission rows it was read under, the same
 * revision every cache here is filed under. A write anywhere moves it: in this
 * request, in another request of this process, or on another instance, which
 * the refresh below reads at most once per epoch interval, as every pooled
 * check does. So what one request kept is retired by a revocation made in
 * another, as each cache is. While no revision can be trusted, nothing is kept.
 */
async function keptForRequest<T>(
  userId: string,
  question: string,
  load: () => Promise<T>
): Promise<T> {
  const revision = await refreshEpoch();
  if (!stampIsCurrent(revision)) return load();
  return rememberForRequest(userId, question, revision, load);
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
    if (executor !== undefined || dialect !== undefined) {
      return await new PermissionChecker(dialect).answerPermission(
        userId,
        action,
        resource,
        executor
      );
    }
    // On the pool, answered from what the request already holds about the
    // user, so however many permissions a request asks, their roles and
    // grants are read once. A failure fails closed here, so a denial caused
    // by a failed read is not the answer for the request.
    return await heldThisRequest(userId, action, resource);
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

/**
 * Whether the user holds `action` on `resource`, from their resolved actor:
 * super-admin authority, then their grants. The same answer the targeted
 * check computes from the same rows, so a request that asks several
 * permissions walks the user's roles once.
 *
 * @throws when the grants cannot be read and the user is not a super-admin;
 * each caller fails closed.
 */
async function heldThisRequest(
  userId: string,
  action: string,
  resource: string
): Promise<boolean> {
  if (!userId || !action || !resource) return false;
  let actor: ResolvedActor;
  try {
    actor = await actorThisRequest(userId);
  } catch (error) {
    // Super-admin authority rests on the roles alone and is decided before
    // any grant is consulted, so a failed grants read does not refuse it.
    // Anyone else is refused: their answer needs the grants.
    if (holdsSuperAdmin(await roleSlugsOnTheirOwn(userId))) return true;
    throw error;
  }
  return (
    actor.superAdmin ||
    actor.grants.some(
      grant => grant.action === action && grant.resource === resource
    )
  );
}

export async function hasAnyPermission(
  userId: string,
  checks: PermissionCheck[]
): Promise<boolean> {
  if (!userId || !Array.isArray(checks) || checks.length === 0) return false;
  // Any one will do. A check that could not be answered refuses only itself,
  // and the next is still asked.
  for (const { action, resource } of checks) {
    try {
      if (await heldThisRequest(userId, action, resource)) return true;
    } catch {
      getAuthLogger()?.log?.("error", {
        category: "auth",
        op: "error",
        userId,
        action,
        resource,
      });
    }
  }
  return false;
}

/**
 * Lists all effective permissions for a user by resolving role assignments and inheritance.
 * Returns permissions in the format '<resource>:<action>' (e.g., 'users:read', 'content:create').
 *
 * Derived from {@link listEffectiveGrants}, the one lookup, so the two can
 * never name different permissions for one caller.
 */
export async function listEffectivePermissions(
  userId: string,
  // Optional transaction-bound executor; see `hasPermission`.
  executor?: unknown
): Promise<string[]> {
  const grants = await listEffectiveGrants(userId, executor);
  return Array.from(
    new Set(grants.map(grant => `${grant.resource}:${grant.action}`))
  ).sort();
}

/**
 * The permissions a user holds through their roles, inheritance included, as
 * the rows name them: each one's stored slug and the action and resource it
 * grants. Sorted by slug, each slug once.
 *
 * The rows rather than one spelling of them, because a rule is handed the
 * stored slug (`read-posts`) and, for one release, the earlier
 * `<resource>:<action>` spelling too, and a slug cannot be rebuilt from its
 * parts: `manage-api-keys` grants `update` on `api-keys`.
 *
 * Empty for a missing user id. A lookup that fails refuses rather than
 * answering empty: an empty list only denies a rule that asks for a
 * permission, and allows one that asks for the absence of one.
 *
 * @throws NextlyError when the permissions cannot be read.
 */
export async function listEffectiveGrants(
  userId: string,
  // Optional transaction-bound executor; see `hasPermission`.
  executor?: unknown
): Promise<GrantedPermission[]> {
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
      return await loadEffectiveGrants(userId, executor);
    }
    // A list of its own for each caller: a rule handed it may change it.
    try {
      return [...(await actorThisRequest(userId)).grants];
    } catch {
      // The actor is all of a user's access read together. When part of it
      // fails, the grants are read on their own, so a reader that keeps
      // whichever half it could read still gets the half that can be read.
      const { roleIds } = await new PermissionChecker().walkRoles(userId);
      return grantsOf(userId, roleIds);
    }
  } catch (cause) {
    throw unreadable(cause, { reason: "permissions-unreadable", userId });
  }
}

/**
 * The refusal for a role or permission set that could not be read: "database
 * busy" when the read waited out its connection bound, and an internal error
 * otherwise. Thrown rather than answered with an empty set, which a rule
 * reads as a caller holding nothing.
 */
function unreadable(
  cause: unknown,
  logContext: Record<string, unknown>
): NextlyError {
  // Logged here, where the failure is known: a field rule that receives the
  // refusal is denied by its own guard, which records nothing of why.
  getAuthLogger()?.log?.("error", {
    category: "auth",
    op: "permissions",
    ...logContext,
    error: String(cause),
  });
  const error = cause instanceof Error ? cause : undefined;
  return isDatabaseBusy(cause)
    ? NextlyError.databaseBusy({ cause: error, logContext })
    : NextlyError.internal({ cause: error, logContext });
}

/** The lookup behind {@link listEffectiveGrants}; throws on a failed read. */
async function loadEffectiveGrants(
  userId: string,
  executor?: unknown
): Promise<GrantedPermission[]> {
  const checker = new PermissionChecker();
  const roleIds = await checker.getAllRoleIdsForUser(userId, executor);
  return grantsOf(userId, roleIds, executor);
}

/**
 * The permissions `roleIds` grant, as their rows name them, each slug once
 * and sorted by slug. Throws on a failed read.
 */
async function grantsOf(
  userId: string,
  roleIds: ReadonlySet<string>,
  executor?: unknown
): Promise<GrantedPermission[]> {
  if (roleIds.size === 0) {
    return [];
  }

  const t = getTablesLazy();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { rolePermissions, permissions } = t as any;

  // Join role_permissions with permissions to get all permissions for user's roles
  const rows = await rbacQuery(executor)
    .select({
      slug: permissions.slug,
      action: permissions.action,
      resource: permissions.resource,
    })
    .from(rolePermissions)
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(inArray(rolePermissions.roleId, Array.from(roleIds)));

  // Each slug once: two roles granting one permission name the same row. The
  // three columns are NOT NULL, so the narrowing below keeps every real row.
  const bySlug = new Map<string, GrantedPermission>();
  for (const { slug, action, resource } of rows) {
    if (
      typeof slug === "string" &&
      typeof action === "string" &&
      typeof resource === "string" &&
      !bySlug.has(slug)
    ) {
      bySlug.set(slug, { slug, action, resource });
    }
  }
  const result = [...bySlug.values()].sort((a, b) =>
    a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0
  );

  if (process.env.DEBUG_RBAC === "1") {
    consoleLogger.info("[permissions][dbg] listEffectiveGrants", {
      userId,
      roleCount: roleIds.size,
      permissionCount: result.length,
      permissions: result.map(grant => grant.slug),
    });
  }

  return result;
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
  return publishedEpoch();
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
 * numbers say. A batch of permission writes holds one open for its whole
 * length, and publishing the role version, after emptying the retired stored
 * answers while they exist, is itself awaited: a check that starts and
 * finishes inside either reads rows mid-change, compares two
 * numbers that have not moved since it captured one, and would keep an answer
 * the change is about to retire. Nothing is cacheable while a retirement runs.
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
 * Retire what is kept about users' access: the actors this process keeps, and,
 * by publishing the role version, what every other instance keeps.
 *
 * Called when user roles or role permissions change.
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
 * Forgets every actor this process keeps and publishes the role version, which
 * retires what every instance keeps and the caches derived from it, an API
 * key's copied grants among them.
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
 * Run a batch of permission-row writes under ONE publish of the role version.
 *
 * Every publish sends every instance back to read its users' access again,
 * which is the right cost once and the wrong cost per row: a seeder calls
 * `ensurePermission` once per permission, so a single new collection would
 * publish six times over, each after the first retiring access the previous
 * one had already retired.
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
 * Forget every actor this process keeps.
 *
 * Free: no query, no lock, nothing to defer. So it happens on every
 * invalidation, including the ones a batch defers the rest of.
 */
function clearInMemoryTiers(): void {
  actorCache.clear();
}

/**
 * Forget the actors this process keeps, and nothing else, for a test that
 * needs the next check to read the rows as a fresh instance would. Exported
 * rather than reached through a mock because the state is this module's own;
 * the epoch is left exactly as it is.
 */
export function clearInMemoryPermissionTiersForTests(): void {
  clearInMemoryTiers();
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
    // Retired here, announced at the exit. The actors this process keeps cost
    // nothing to forget, so none outlives the row it came from. The role
    // version is published once rather than per write: a batch can make many
    // writes, and every instance reads its actors again after each publish.
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
 * Empty the retired stored answers, then publish the role version that retires
 * every actor kept in every instance.
 *
 * Nothing here reads the stored answers, but an instance still running an
 * earlier release does, while the table exists, and the version is the only
 * signal it receives; see `init/retired-permission-answers`. So a retirement
 * whose emptying failed publishes nothing: published, the version would tell
 * such an instance to drop its in-memory answer and read a stored row the
 * failure left live, filing it under the new version where nothing left to
 * happen can reach it. Withheld, those rows are served until their own expiry,
 * as they would have been. This process still retires what it kept: its actors
 * were dropped before this ran, and everything else it filed under the role
 * version, an API key's copied grants among them, stops being current here.
 *
 * The depth is held across both steps, so nothing this process resolves while
 * they run is kept as current; see {@link resolvedUnderCurrentRevision}. A
 * version write that fails is owed rather than lost; see `bumpEpoch`.
 */
async function publishRetirement(): Promise<void> {
  await duringRetirement(async () => {
    try {
      await emptyRetiredPermissionAnswers(getAdapter());
    } catch (error) {
      // Reported, not thrown: an invalidation failure must not break the
      // write that raised it. Unpublished, though, for the reason above.
      getAuthLogger()?.log?.("error", {
        category: "auth",
        op: "cache",
        message: "Emptying the retired stored permission answers failed",
        error: String(error),
      });
      retireHereOnly();
      return;
    }
    await bumpEpoch();
  });
}

/** The table the earlier release stored permission answers in. */
const STORED_ANSWERS_TABLE = "user_permission_cache";

/**
 * Whether an instance on the release that reads the stored answers may be
 * reading them.
 *
 * `PERMISSION_CACHE_ENABLED=false` (or `0`) turned the stored answers off in
 * that release, so an instance running it with the same setting reads none,
 * and emptying them protects nobody. Read for that alone, on each retirement:
 * the setting changes nothing else here.
 */
function storedAnswersReadElsewhere(): boolean {
  const setting = process.env.PERMISSION_CACHE_ENABLED;
  return setting !== "false" && setting !== "0";
}

async function flushPermissionCaches(): Promise<void> {
  clearInMemoryTiers();
  await publishRetirement();
}

export async function invalidatePermissionCache(
  _hint: { userId?: string; roleId?: string } = {}
): Promise<void> {
  const { userId, roleId } = _hint || {};
  // This request changed someone's roles; nothing it looked up stands.
  forgetRequestAccess();

  // The kept actor goes with them. A role hint clears every actor rather
  // than a subset: what a role reaches is the users holding it, directly or
  // through inheritance, which this process does not record, and re-reading
  // an actor is one walk of a user's roles. A role change is rare; guessing
  // at the subset is how a demotion survives.
  if (userId) actorCache.delete(userId);
  if (roleId) actorCache.clear();

  await publishRetirement();
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
      return await superAdminForRequest(userId);
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

/**
 * Whether a user holds `super-admin`, refusing rather than answering `false`
 * when the roles cannot be read: for a reader on the pool that must tell "not
 * a super-admin" from "could not tell", such as one that answers many
 * questions from a single read and would otherwise answer them all as a
 * non-admin. The same decision `isSuperAdmin` asks, from the same actor.
 *
 * @throws NextlyError when the roles cannot be read.
 */
export async function isSuperAdminOrRefuse(userId: string): Promise<boolean> {
  if (!userId) return false;
  try {
    return await superAdminForRequest(userId);
  } catch (cause) {
    throw unreadable(cause, { reason: "roles-unreadable", userId });
  }
}

/**
 * The pooled decision, from the actor resolved once per request: the one read
 * `isSuperAdmin` and `isSuperAdminOrRefuse` both answer from. Throws when the
 * roles cannot be read; each caller decides what that means.
 */
async function superAdminForRequest(userId: string): Promise<boolean> {
  try {
    return (await actorThisRequest(userId)).superAdmin;
  } catch {
    // Decided from the roles alone, as it needs nothing else, so a failed
    // grants read does not refuse a super-admin.
    return holdsSuperAdmin(await roleSlugsOnTheirOwn(userId));
  }
}

/**
 * The super-admin answer for a check made through a transaction. Nothing is
 * read from or kept in the actor cache, since the answer reflects the
 * transaction's uncommitted rows.
 */
async function superAdminAnswer(
  userId: string,
  executor: unknown
): Promise<boolean> {
  try {
    return await decideSuperAdmin(userId, executor);
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
 * The same decision as `isSuperAdmin` makes through a transaction: both run
 * `decideSuperAdmin`. Meant for an executor-backed check inside a
 * transaction, so neither the kept actor nor the pooled revision is consulted.
 */
export async function isSuperAdminOrThrow(
  userId: string,
  executor: unknown
): Promise<boolean> {
  if (!userId) return false;
  return decideSuperAdmin(userId, executor);
}

/**
 * The super-admin decision itself, for a check made through a transaction:
 * resolve the user's roles (inherited ones included) through it and ask
 * whether any is `super-admin`. Nothing is kept, since the answer reflects the
 * transaction's uncommitted rows. Throws on a failed read; each caller decides
 * what a failure means.
 */
async function decideSuperAdmin(
  userId: string,
  executor: unknown
): Promise<boolean> {
  const checker = new PermissionChecker();
  const { roleIds } = await checker.resolveRoles(userId, executor);
  if (roleIds.size === 0) return false;

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

  return superAdmin.length > 0;
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
 * Get role slugs for a user by resolving role IDs to slugs.
 *
 * Used by the RBAC AccessControlService to build context for code-defined
 * access functions that need role slug information.
 *
 * @param userId - The user ID
 * @returns Array of role slugs (e.g., ['super-admin', 'editor'])
 * @throws NextlyError when the roles cannot be read: DATABASE_BUSY when the
 *   read waited out its connection bound, an internal error otherwise.
 */
export async function listRoleSlugsForUser(
  userId: string,
  // Optional transaction-bound executor; see `hasPermission`.
  executor?: unknown
): Promise<string[]> {
  // A role set that cannot be read refuses rather than answering empty: an
  // empty set only denies a rule that asks for a role, and allows one that
  // asks for the absence of one.
  return listRoleSlugsForUserOrRefuse(userId, executor);
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
    throw unreadable(cause, { reason: "roles-unreadable", userId });
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
  // A list of its own for each caller; see `listEffectivePermissions`.
  try {
    return [...(await actorThisRequest(userId)).roleSlugs];
  } catch {
    // Read on their own when the actor cannot be read whole, so a failed
    // grants read leaves the roles a reader could read standing.
    return roleSlugsOnTheirOwn(userId);
  }
}

/**
 * A user's role slugs, inherited ones included, read without their grants:
 * what still answers the questions that rest on roles alone when the actor
 * cannot be read whole. Throws on a failed read.
 */
async function roleSlugsOnTheirOwn(userId: string): Promise<string[]> {
  const { roleIds } = await new PermissionChecker().walkRoles(userId);
  return roleSlugsOf(roleIds);
}

/** Whether these role slugs carry super-admin authority. */
function holdsSuperAdmin(roleSlugs: readonly string[]): boolean {
  return roleSlugs.includes("super-admin");
}

/** The lookup behind {@link listRoleSlugsForUserStrict}; throws on failure. */
async function loadRoleSlugs(
  userId: string,
  executor?: unknown
): Promise<string[]> {
  const checker = new PermissionChecker();
  const roleIds = await checker.getAllRoleIdsForUser(userId, executor);
  return roleSlugsOf(roleIds, executor);
}

/** The slugs of `roleIds`. Throws on a failed read. */
async function roleSlugsOf(
  roleIds: ReadonlySet<string>,
  executor?: unknown
): Promise<string[]> {
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
