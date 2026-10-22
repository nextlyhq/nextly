/**
 * Direct API Namespace Helpers
 *
 * Pure utility functions shared by every namespace module. Contains config
 * merging, error conversion, ID/slug heuristics, and record-to-public-type
 * mappers. None of these helpers close over instance state — callers pass in
 * whatever they need (default config, raw record, etc.).
 *
 * @packageDocumentation
 */

import { runWithAccessMemo } from "../../auth/access/request-memo";
import type { AuthenticatedScope } from "../../auth/authenticated-scope";
import {
  authorizeCaller,
  authorizeCallerForAny,
  isErrorResponse,
  type AuthContext,
} from "../../auth/middleware";
import { toNextlyAuthError } from "../../auth/middleware/to-nextly-error";
import { runAsPrincipal } from "../../auth/principal-scope";
import type { RequestActor } from "../../auth/request-actor";
import {
  roleChangeCallerFor,
  runAsRoleChangeCaller,
} from "../../domains/auth/services/role-change-caller";
import type { RouteGrant } from "../../domains/auth/system-write-policy";
import { errorFromServiceEnvelope } from "../../errors/from-service-envelope";
import { NextlyError } from "../../errors/nextly-error";
import { assertRunnableAsPrincipal } from "../../plugins/principals/run-as";
import type { TrustBound } from "../../services/collections/trust-grant";
import type { RequestContext } from "../../shared/types/index";
import type {
  DirectAPIConfig,
  FieldGroupDefinition,
  ListResult,
  Permission,
  Role,
  RunAsPrincipal,
  SingleDefinition,
  UserContext,
} from "../types/index";

/**
 * Merge operation-specific config with the Direct API's default config.
 *
 * Operation-level options win; defaults fill in the rest (e.g. `overrideAccess`
 * defaults to `true` unless the call sets it to `false`).
 */
export function mergeConfig<T extends DirectAPIConfig>(
  defaultConfig: DirectAPIConfig,
  args: T
): T & DirectAPIConfig {
  return {
    ...defaultConfig,
    ...args,
  };
}

/**
 * Run one collection or Single operation as the caller it names.
 *
 * A call naming a plugin-defined person runs inside that person's frame
 * (`auth/principal-scope`), so every access decision, field rule and hook
 * the operation reaches sees the person, however many hops it takes to get
 * there. It runs under access rules: `overrideAccess` is set to `false`
 * for it, which replaces the instance default of `true` rather than
 * inheriting it, and a call that asks to skip the rules, or that also names a
 * staff user or an API key, is refused before anything runs.
 *
 * A call naming no person opens a frame with none, so it never inherits the
 * person of an operation that set it going, such as a hook's own call.
 *
 * Async, so a refusal reaches the caller as a rejected promise like every
 * other failure of the operation, never as a throw from the call itself.
 */
export async function runAsCaller<
  A extends DirectAPIConfig & RunAsPrincipal,
  R,
>(
  defaultConfig: DirectAPIConfig,
  args: A,
  operation: (args: A) => Promise<R>
): Promise<R> {
  // One memo of access lookups for the call, so a list whose field rules ask
  // about the caller on every row looks the caller up once. A call made inside
  // a request shares that request's memo.
  return runWithAccessMemo(() =>
    runAsCallerInMemo(defaultConfig, args, operation)
  );
}

function runAsCallerInMemo<A extends DirectAPIConfig & RunAsPrincipal, R>(
  defaultConfig: DirectAPIConfig,
  args: A,
  operation: (args: A) => Promise<R>
): Promise<R> {
  const { principal } = args;
  if (principal === undefined) {
    return runAsPrincipal(null, () => operation(args));
  }
  return runAsPrincipal(principal, () => {
    // Checked inside the person's frame so the options read through
    // `mergeConfig` like any operation's. Nothing has run when it refuses.
    const config = mergeConfig(defaultConfig, args);
    assertRunnableAsPrincipal(principal, {
      user: config.user,
      fieldAccessUser: config.fieldAccessUser,
      actor: config.actor,
      // The call's own bound, not an instance default: a bound narrows an
      // override, and a person's call has none for it to narrow.
      trusted: args.trusted,
      // The call's own setting, never the instance default of `true`, which
      // a call made as a person replaces rather than asks for.
      overrideAccess: args.overrideAccess,
      // Only `find` and `count` take it; read off the call itself, since no
      // config supplies it.
      frameworkFilter: (args as { frameworkFilter?: unknown }).frameworkFilter,
    });
    return operation({ ...args, overrideAccess: false });
  });
}

/**
 * The acting identity a Direct API call carries, if it carries one.
 *
 * `DirectAPIConfig.user` is how a caller says who this operation is for --
 * required whenever `overrideAccess` is false, and available whenever the
 * caller knows. Forwarding it is what lets a write through this API be
 * attributed like a write through the admin, instead of the trail silently
 * covering one supported surface and not the other.
 *
 * Absent means absent: a call that names nobody records nothing, rather than
 * being attributed to a placeholder. Per-operation config wins over the
 * instance default, matching `mergeConfig`, so a single call can act as
 * someone without reconfiguring the instance.
 *
 * An API key is recorded AS a key, never as its owner. A key carries the
 * owner's `user` so the operation can be authorized, and reading that as the
 * acting identity would put a person's name against a write they did not make
 * -- which is worse than an absent entry, because it is a plausible one. The
 * key's own id is not on this config, so the entry carries the type alone:
 * `RequestActor.id` is optional precisely so an actor can be named less
 * precisely rather than wrongly.
 */
export function directApiActor(
  defaultConfig: DirectAPIConfig,
  args: DirectAPIConfig
): RequestActor | undefined {
  // Read as the access check reads the call (`suppliedByCall`): a call naming a
  // user without a key is that person, not the instance's key, so the record
  // names whoever the check judged.
  const config = mergeConfig(defaultConfig, suppliedByCall(args));
  if (config.actor?.actorType === "apiKey") return { type: "apiKey" };

  const id = config.user?.id;
  return id ? { type: "user", id } : undefined;
}

/**
 * Every field a service needs to decide whether this caller may see a row.
 */
export interface AccessOptions {
  user?: UserContext;
  overrideAccess?: boolean;
  enforceFieldAccess?: boolean;
  fieldAccessUser?: UserContext;
  trusted?: TrustBound;
  authenticatedScope?: AuthenticatedScope;
  /** The HTTP request behind this operation, when one produced it. */
  request?: Request;
}

/**
 * The access-bearing fields of a Direct API call, as one spreadable object.
 *
 * `user` says WHO is calling; `authenticatedScope` says what kind of caller and
 * which grants the API KEY itself carries, which is what stops an update-only
 * key from reading on the strength of its owner's permissions. The two travel
 * together because a service that receives one without the other judges a
 * scoped key by its owner — the exact leak this exists to close.
 *
 * `overrideAccess` grants the bypass, `trusted` bounds it per RELATED
 * collection as relationships are expanded, and `enforceFieldAccess` takes back
 * the half of it that governs field rules. They belong in one object for the
 * same reason as the pair above: a flag separated from the bounds that narrow
 * it is how an option ends up honoured by some operations and not others, and
 * an expansion that receives the grant without the bound reads every populated
 * target trusted — including drafts, into a page that may be pre-rendered.
 * `enforceFieldAccess` travels here for the sharper version of that: an
 * operation that forwarded the override and dropped it would hand back exactly
 * the field bypass the caller asked to keep enforced.
 *
 * Spread this rather than listing the fields inline: an operation that forwards
 * `user` but not `authenticatedScope` compiles, runs, and silently authorizes
 * the key as its owner. `access-options-seam.test.ts` fails the build if a
 * namespace hand-writes them instead.
 */
export function accessOptions(config: DirectAPIConfig): AccessOptions {
  return {
    user: config.user,
    overrideAccess: config.overrideAccess,
    enforceFieldAccess: config.enforceFieldAccess,
    fieldAccessUser: config.fieldAccessUser,
    trusted: config.trusted,
    authenticatedScope: config.actor,
    request: config.request,
  };
}

/**
 * What a call supplies over the instance's defaults, as one credential.
 *
 * A call that passes `overrideAccess: undefined` keeps the instance's setting:
 * `mergeConfig` is a spread and a present-but-undefined key wins it, which
 * would otherwise erase an instance's `false` and quietly restore trust.
 *
 * `user` and the key scope `actor` are one credential. A call that names a
 * user without naming a key is made as that person, not under the instance's
 * key: keeping the instance's scope while swapping the user would authorize
 * the call by grants that were never the new user's. A call that names
 * `user: undefined` names nobody, and is refused.
 */
function suppliedByCall(args: DirectAPIConfig): DirectAPIConfig {
  const supplied: DirectAPIConfig = { ...args };
  if (supplied.overrideAccess === undefined) delete supplied.overrideAccess;
  if ("user" in args && !("actor" in args)) supplied.actor = undefined;
  return supplied;
}

/**
 * The caller as the REST routes see one: a person signed in, or an API key
 * judged by its own grants rather than its owner's.
 *
 * A key carries its whole scope, as REST's authenticated caller does: its
 * permissions, the grant rows behind them and its OWN role slugs, never its
 * owner's, since a rule may decide on a role. The inverse of
 * `apiKeyScopeFrom`, so the scope a call names is the scope it is judged by.
 */
function asRouteCaller(userId: string, access: AccessOptions): AuthContext {
  const scope = access.authenticatedScope;
  if (scope?.actorType === "apiKey") {
    return {
      userId,
      authMethod: "api-key",
      permissions: [...scope.permissions],
      ...(scope.grants ? { grants: scope.grants } : {}),
      roles: [...(scope.roles ?? [])],
    };
  }
  return {
    userId,
    authMethod: "session",
    permissions: [],
    roles: access.user?.roles ?? [],
  };
}

/**
 * The caller a checked operation on a system resource is made as, or `null`
 * for a trusted one.
 *
 * Checked when the call, over the instance's defaults, says
 * `overrideAccess: false`. Read through `accessOptions`, so the identity and
 * the key scope travel together as they do at every other namespace. A checked
 * call names who it is for, as a REST request must be signed in, so one that
 * names nobody is refused here.
 *
 * Takes the defaults rather than a namespace's context, so a plugin service
 * that resolves its own options asks the same question.
 */
export function checkedCaller(
  defaultConfig: DirectAPIConfig,
  args: DirectAPIConfig
): AuthContext | null {
  const access = accessOptions(
    mergeConfig(defaultConfig, suppliedByCall(args))
  );
  if (access.overrideAccess !== false) return null;

  const userId = access.user?.id;
  if (!userId) {
    throw NextlyError.authRequired({
      logContext: { reason: "checked-direct-api-call-names-no-user" },
    });
  }
  return asRouteCaller(userId, access);
}

// What a write asks, declared with the policy that says which write asks what.
export type { RouteGrant };

/**
 * The key scope a call is checked with: the instance's and the call's, read
 * as `checkedCaller` reads them, so a call naming a user without a key has
 * none. A write runs what it sets going under this, so a handler it starts
 * cannot use grants the call gave up.
 */
export function checkedScope(
  defaultConfig: DirectAPIConfig,
  args: DirectAPIConfig
): AuthenticatedScope | undefined {
  return accessOptions(mergeConfig(defaultConfig, suppliedByCall(args)))
    .authenticatedScope;
}

/**
 * Whether `caller` holds `grant`, asked of the decision the REST route asks,
 * so one caller gets one answer through either door: `authorizeCaller` (the
 * `requirePermission` decision) for one permission, `authorizeCallerForAny`
 * (`requireAnyPermission`'s) for any of several. A refusal is FORBIDDEN.
 */
export async function authorizeChecked(
  caller: AuthContext,
  grant: RouteGrant
): Promise<void> {
  const decision =
    "anyOf" in grant
      ? await authorizeCallerForAny(caller, [...grant.anyOf])
      : await authorizeCaller(caller, grant.action, grant.resource);
  if (isErrorResponse(decision)) throw toNextlyAuthError(decision);
}

/**
 * The check a write to a system resource runs first, before any work: nothing
 * for a trusted call, and for a checked one the caller's `grant`, refused as
 * REST refuses it. Returns the checked caller, or `null` for a trusted call.
 */
export async function checkWrite(
  defaultConfig: DirectAPIConfig,
  args: DirectAPIConfig,
  grant: RouteGrant
): Promise<AuthContext | null> {
  const caller = checkedCaller(defaultConfig, args);
  if (caller) await authorizeChecked(caller, grant);
  return caller;
}

/**
 * The check a read of a system resource runs first: a write's, asked with the
 * grant REST's read route asks, so a checked read is refused before anything
 * is read and a trusted one is untouched.
 */
export const checkRead = checkWrite;

/**
 * A write that may change who holds which role, run as REST runs it: checked
 * first, when the call asks to be, and then as its caller for the rule on
 * granting super-admin, which only a super-admin person passes and an API key
 * never does. A trusted call runs as trusted server code, which that rule
 * allows.
 */
export async function checkedRoleChange<T>(
  defaultConfig: DirectAPIConfig,
  args: DirectAPIConfig,
  grant: RouteGrant,
  write: () => Promise<T>
): Promise<T> {
  const caller = await checkWrite(defaultConfig, args, grant);
  if (!caller) return write();
  return runAsRoleChangeCaller(roleChangeCallerFor(caller), write);
}

/**
 * The same three fields, for one namespace operation calling another.
 *
 * A nested Direct API call re-enters `mergeConfig`, so anything the caller
 * leaves out is filled from the instance defaults — and `overrideAccess`
 * defaults to `true`. An operation that omits these does not inherit the
 * caller's restrictions, it discards them: a key scoped to update a row could
 * update it under its own grants and then read the result back with access
 * checks off entirely, past field redaction it was never allowed to see.
 *
 * Distinct from `accessOptions` because the boundary is different. A service
 * takes the caller's scope as `authenticatedScope`; a Direct API operation
 * takes it as `actor` and translates it itself.
 */
export function callerAccess(
  config: DirectAPIConfig & RunAsPrincipal
): Pick<
  DirectAPIConfig & RunAsPrincipal,
  | "user"
  | "overrideAccess"
  | "enforceFieldAccess"
  | "fieldAccessUser"
  | "trusted"
  | "actor"
  | "request"
  | "principal"
> {
  return {
    user: config.user,
    // A nested call opens its own frame from what it is handed, so the person
    // travels with it: dropped, the readback of a person's write would run as
    // nobody, and a rule-less collection admits nobody to its public default.
    principal: config.principal,
    overrideAccess: config.overrideAccess,
    // Carried for the same reason as `trusted` below: a nested call that omits
    // it re-enters `mergeConfig` and takes the instance default, which is
    // absent — so the caller's request to keep field rules enforced would be
    // silently traded back for the full bypass.
    enforceFieldAccess: config.enforceFieldAccess,
    fieldAccessUser: config.fieldAccessUser,
    // The bound travels with the grant here for the same reason it does in
    // `accessOptions`, and the stakes are higher: a nested call that omits it
    // re-enters `mergeConfig` and takes the INSTANCE default, so the caller's
    // bound is not merely lost — it is replaced by an unbounded override.
    trusted: config.trusted,
    actor: config.actor,
    // Same reason again, one field over: a nested read that omits it re-enters
    // `mergeConfig` and takes the INSTANCE default, so a readback would be
    // classified differently from the write it is reading back -- background
    // work beside a visitor's write, in one operation.
    request: config.request,
  };
}

/**
 * Build a RequestContext for downstream services from a Direct API call.
 *
 * Maps the narrow `DirectAPIConfig.user` shape to the richer `RequestContext`
 * expected by service-layer methods, supplying safe defaults for fields that
 * aren't available in a Direct API context.
 */
export function createRequestContext(args: DirectAPIConfig): RequestContext {
  if (!args.user) {
    return { locale: args.locale };
  }

  return {
    user: {
      id: args.user.id,
      // Preserve the caller's real email so email-based access rules match.
      email: typeof args.user.email === "string" ? args.user.email : "",
      role: args.user.role ?? "user",
      permissions: [],
    },
    locale: args.locale,
  };
}

/**
 * Shape of a generic service result used by the Direct API error converter.
 */
export interface ServiceResultLike {
  success: boolean;
  statusCode: number;
  /**
   * Canonical `NextlyError` code carried by envelopes that originate from a
   * NextlyError. Preferred over the status-derived fallback because one
   * status can cover several codes (409 is both DUPLICATE and CONFLICT).
   */
  code?: string;
  message: string;
  /** Translation key for the public message, when the thrower set one. */
  messageKey?: string;
  /** The error's own public data -- a rate limit's retry interval, and such. */
  publicData?: unknown;
  data: unknown;
  errors?: Array<{ path: string; code: string; message: string }>;
}

/**
 * Convert a failed service-layer result into a `NextlyError`.
 */
export function createErrorFromResult(result: ServiceResultLike): NextlyError {
  // The shared converter, so a Direct API caller and a REST caller are handed
  // the same error for the same failure. Its code-keyed rebuild carries the
  // message key and public data that this boundary used to drop.
  //
  // The rebuilt error is right for the caller and blind for whoever debugs it:
  // the driver error underneath and the identifiers the thrower attached were
  // dropped on the way through the public envelope. The converter chains the
  // original back on as `cause` by reading it off the envelope, and the spread
  // below is what carries it there — it is an enumerable own property, so it
  // survives into the object handed over.
  return errorFromServiceEnvelope(result, {
    // The service's own text, kept for the operator. A code-less failure now
    // answers with a generic sentence, because its message may be a raw
    // exception's; withholding it from the caller is the point, and discarding
    // it as well would make exactly those failures undiagnosable.
    legacyMessage: result.message,
    ...(result.data !== undefined && result.data !== null
      ? { resultData: result.data }
      : {}),
  });
}

/**
 * Shape of a failed single-entry service result.
 */
export interface SingleResultLike {
  success: boolean;
  statusCode: number;
  /** Canonical `NextlyError` code, when the envelope came from one. */
  code?: string;
  message?: string;
  /** Translation key for the public message. */
  messageKey?: string;
  /** The error's own public data -- a rate limit's retry interval, and such. */
  publicData?: unknown;
  errors?: Array<{ field?: string; code?: string; message: string }>;
}

/**
 * Convert a failed single-entry service result into a `NextlyError`.
 */
export function createErrorFromSingleResult(
  result: SingleResultLike
): NextlyError {
  const message =
    result.message ||
    result.errors?.map(e => e.message).join(", ") ||
    "Operation failed";

  // The shared converter, so a Single failure reaches a Direct API caller as
  // the same error a REST caller gets. Rebuilding from status alone dropped the
  // message key and the public data -- a rate limit's retry interval among it.
  return errorFromServiceEnvelope(
    {
      ...result,
      message,
      // Normalised to the canonical shape; SingleResult still emits `{field}`.
      errors: result.errors?.map(e => ({
        path: e.field,
        // The per-field reason travels with the issue; dropping it here would
        // have the converter substitute a generic one.
        code: e.code,
        message: e.message,
      })),
    },
    // The NORMALISED message, not `result.message`. A Single failure may omit
    // the top-level one and carry per-field `errors` instead, in which case the
    // text above is synthesised from them -- and that synthesised text is what
    // the converter replaces with a generic sentence for a non-validation
    // status. Logging the raw field would record `undefined` in exactly the
    // case where the caller's text was withheld.
    { legacyMessage: message }
  );
}

/**
 * Returns `true` when the thrown value represents a "not found" outcome.
 *
 * Used to honor the `disableErrors` flag on find operations so callers get
 * `null` instead of an exception. Uses the canonical type guard so the check
 * survives package-boundary identity issues (when one consumer's NextlyError
 * is a different module instance from ours, instanceof returns false).
 */
export function isNotFoundError(error: unknown): boolean {
  return NextlyError.isNotFound(error);
}

/**
 * Heuristic test: does this string look like an ID (UUID, numeric, or CUID)
 * rather than a slug? Used by forms to decide whether to resolve by slug first.
 */
export function looksLikeId(value: string): boolean {
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    )
  ) {
    return true;
  }

  if (/^\d+$/.test(value)) {
    return true;
  }

  if (/^c[a-z0-9]{24,}$/i.test(value)) {
    return true;
  }

  return false;
}

/**
 * Shape of a raw role record as returned by the service layer.
 *
 * SQLite stores booleans as `0`/`1`, so `isSystem` can be either `boolean` or
 * `number`; the mapper normalizes it to `boolean`.
 */
export interface RawRoleRecord {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  level: number;
  isSystem: boolean | number;
}

/**
 * Normalize a raw role record from the service layer into the public `Role` type.
 */
export function mapRole(role: RawRoleRecord): Role {
  return {
    id: role.id,
    name: role.name,
    slug: role.slug,
    description: role.description ?? null,
    level: role.level,
    isSystem: Boolean(role.isSystem),
  };
}

/**
 * Shape of a raw permission record as returned by the service layer.
 */
export interface RawPermissionRecord {
  id: string;
  name: string;
  slug: string;
  action: string;
  resource: string;
  description?: string | null;
}

/**
 * Normalize a raw permission record from the service layer into the public
 * `Permission` type.
 */
export function mapPermission(perm: RawPermissionRecord): Permission {
  return {
    id: perm.id,
    name: perm.name,
    slug: perm.slug,
    action: perm.action,
    resource: perm.resource,
    description: perm.description ?? null,
  };
}

/**
 * Shape of a raw field group record as returned by the registry service.
 */
export interface RawFieldGroupRecord {
  id: string;
  slug: string;
  label: string;
  tableName: string;
  description?: string | null;
  fields: unknown;
  admin?: unknown;
  source: string;
  locked: boolean;
  configPath?: string | null;
  schemaHash: string;
  schemaVersion: number;
  migrationStatus: string;
  lastMigrationId?: string | null;
  createdBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
  /**
   * Optional here and REQUIRED on the mapped definition, deliberately.
   *
   * The registry's own record type declares it non-optional, but this shape also describes rows
   * read back from databases created before the column existed, where the driver returns nothing
   * for it. The mapper collapses both to a boolean, so the public type can promise one.
   */
  localized?: boolean | null;
}

/**
 * Normalize a raw field group record into the public `FieldGroupDefinition` type.
 */
export function mapFieldGroupRecord(
  record: RawFieldGroupRecord
): FieldGroupDefinition {
  return {
    id: record.id,
    slug: record.slug,
    label: record.label,
    tableName: record.tableName,
    description: record.description ?? undefined,
    fields: (Array.isArray(record.fields) ? record.fields : []) as Record<
      string,
      unknown
    >[],
    admin: record.admin as FieldGroupDefinition["admin"],
    // The dialect's storage is already decided elsewhere: the registry's row mapper normalises the
    // integer MySQL and SQLite hold to a boolean, so nothing here re-derives that. This only
    // collapses the optional declaration above, and absent reads false — the shape a row predating
    // the column actually describes.
    localized: record.localized === true,
    source: record.source as "code" | "ui",
    locked: record.locked,
    configPath: record.configPath ?? undefined,
    schemaHash: record.schemaHash,
    schemaVersion: record.schemaVersion,
    migrationStatus:
      record.migrationStatus as FieldGroupDefinition["migrationStatus"],
    lastMigrationId: record.lastMigrationId ?? undefined,
    createdBy: record.createdBy ?? undefined,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * Shape of a raw single (global) record as returned by the single registry.
 */
export interface RawSingleRecord {
  id: string;
  slug: string;
  label: string;
  tableName: string;
  fields: unknown;
  source: string;
  locked: boolean;
  configPath?: string | null;
  schemaHash: string;
  schemaVersion: number;
  migrationStatus: string;
  lastMigrationId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Normalize a raw single (global) record into the public `SingleDefinition` type.
 */
export function mapSingleRecord(record: RawSingleRecord): SingleDefinition {
  return {
    id: record.id,
    slug: record.slug,
    label: record.label,
    tableName: record.tableName,
    fields: (Array.isArray(record.fields) ? record.fields : []) as Record<
      string,
      unknown
    >[],
    source: record.source as "code" | "ui" | "built-in",
    locked: record.locked,
    configPath: record.configPath ?? undefined,
    schemaHash: record.schemaHash,
    schemaVersion: record.schemaVersion,
    migrationStatus:
      record.migrationStatus as SingleDefinition["migrationStatus"],
    lastMigrationId: record.lastMigrationId ?? undefined,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * Shape of a service-layer paginated result used by several namespaces.
 */
export interface PaginatedServiceResult<T> {
  data: T[];
  pagination: { total: number };
}

/**
 * Map a service-layer `{ data, pagination }` tuple into the canonical
 * Direct API `ListResult<T>` shape (`{ items, meta }`).
 *
 * that returned Payload's `{ docs, totalDocs, ... }` shape. The service
 * layer's `pagination.total` maps to `meta.total`; `meta.limit` is the
 * caller-supplied page size, and `meta.totalPages` is recomputed here so
 * we never hand back `0` (clamps to 1 minimum, matching the wire-side
 * `respondList` calculation).
 */
export function toListResult<T>(
  result: PaginatedServiceResult<T>,
  limit: number,
  page: number
): ListResult<T> {
  const total = result.pagination.total;
  // Clamp totalPages to 1 minimum so an empty page-1 result still has a
  // sensible page count (matches wire-side `respondList` behavior).
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return {
    items: result.data,
    meta: {
      total,
      page,
      limit,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  };
}

/**
 * Map an in-memory array into a canonical `ListResult<T>` envelope,
 * slicing the array according to the requested `limit` / `page`.
 *
 * Used by namespaces whose service layer does not natively paginate
 * (emailProviders, emailTemplates, userFields).
 */
export function sliceListResult<T>(
  items: T[],
  limit: number | undefined,
  page: number | undefined
): ListResult<T> {
  const effectiveLimit = limit ?? items.length;
  const effectivePage = page ?? 1;
  const start = (effectivePage - 1) * effectiveLimit;
  const paged = items.slice(start, start + effectiveLimit);
  const total = items.length;
  const totalPages =
    effectiveLimit > 0 ? Math.max(1, Math.ceil(total / effectiveLimit)) : 1;

  return {
    items: paged,
    meta: {
      total,
      page: effectivePage,
      limit: effectiveLimit,
      totalPages,
      hasNext: effectivePage < totalPages,
      hasPrev: effectivePage > 1,
    },
  };
}

/**
 * Build a per-collection mutation message string (e.g. `"Posts created."`).
 * Centralized so every namespace that returns `MutationResult` produces a
 * consistent, capitalized, full-sentence value.
 */
export function buildMutationMessage(
  collection: string,
  verb: "created" | "updated" | "deleted" | "duplicated"
): string {
  const noun = collection.charAt(0).toUpperCase() + collection.slice(1);
  return `${noun} ${verb}.`;
}
