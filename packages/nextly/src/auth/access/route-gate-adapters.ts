/**
 * The REST route gates' answers, and the caller checks beside them, asked of
 * the one decision.
 *
 * A route gate judges the caller a request authenticated, a session or an API
 * key, against one permission (`requirePermission`, `requireCollectionAccess`,
 * a plugin route's `requiredPermission`) or any of several
 * (`requireAnyPermission`). The caller checks ask a gate's question from
 * inside the work: `ctx.caller.can` in a plugin route, a held permission for a
 * dashboard widget or a document lock, and the schema builder's collection
 * list. Each keeps the answer it has always given: where that differs from the
 * decision's, it is kept through a named deviation (`./deviations`), so no
 * answer changes and every difference that remains is one of those names.
 *
 * One permission on an access operation is the collection gate's question
 * asked of the route's caller, so it is answered by the collection gate's
 * adapter: the two have always run the same steps for a session and a key.
 * A plugin's person never reaches a route gate, so none is asked here.
 */
import { parsePermissionSlug } from "../../plugins/routes/permission-slug";
import { permissionSlug } from "../../schemas/_zod/rbac";
import {
  ACCESS_OPERATIONS,
  type AccessOperation,
} from "../../services/access/types";
import {
  hasAnyPermission,
  hasPermission,
} from "../../services/lib/permissions";
import {
  apiKeyScopeFrom,
  type AuthenticatedScope,
} from "../authenticated-scope";
import { getRBACService, type ReadAccessCaller } from "../code-access";
import type { AuthContext } from "../middleware";

import {
  holdsPermission,
  manageCounts,
  type Actor,
  type KeyActor,
} from "./actor";
import { decide, decidePermission, type AccessTarget } from "./decide";
import { declaredTarget } from "./declared-rules";
import { deviate } from "./deviations";
import {
  collectionGateVerdict,
  type CollectionQuestion,
  type GateVerdict,
} from "./gate-adapters";
import {
  actorForKey,
  actorForUser,
  userHoldsPermission,
  userIsSuperAdmin,
} from "./resolve-actor";

/** Where a route gate reads the rules apps declare; absent without the service. */
export type RouteRules = CollectionQuestion["rules"];

/** One permission a route accepts, as `requireAnyPermission` lists them. */
export interface RoutePermission {
  readonly action: string;
  readonly resource: string;
}

/**
 * Who a gate judges: the user the request names and, when a key made the
 * request, the key's own scope and id.
 */
interface GateCaller {
  readonly userId: string;
  /** The key's scope; absent for a session. */
  readonly key?: AuthenticatedScope;
  readonly keyId?: string;
  /** The user's role slugs, which a key's rule falls back to without its own. */
  readonly roles?: readonly string[];
}

const ALLOWED: GateVerdict = Object.freeze({ allowed: true });
const INSUFFICIENT: GateVerdict = Object.freeze({
  allowed: false,
  refusal: "insufficient",
});

const verdictOf = (allowed: boolean): GateVerdict =>
  allowed ? ALLOWED : INSUFFICIENT;

/** Whether an action names an operation an entity's rule can declare. */
function isAccessOperation(action: string): action is AccessOperation {
  return ACCESS_OPERATIONS.some(operation => operation === action);
}

/**
 * Whether one permission is an entity's operation, asked of the target with
 * its rules, rather than a permission alone. A route naming no resource
 * (`requiredPermission: "manage"`) asks about nothing a rule or a permission
 * row can name. A system resource a `manage-` permission still counts on
 * declares no rule, so it is a permission alone, unless an entity registered
 * rules under its name: those rules are read whatever the name.
 */
function asksTheEntity(
  action: string,
  resource: string,
  target: AccessTarget | undefined
): boolean {
  return (
    isAccessOperation(action) &&
    resource !== "" &&
    (target !== undefined || !manageCounts(action, resource))
  );
}

/** The caller the route authenticated. */
function callerOf(auth: AuthContext): GateCaller {
  return auth.authMethod === "api-key"
    ? {
        userId: auth.userId,
        key: apiKeyScopeFrom(auth),
        ...(auth.apiKeyId === undefined ? {} : { keyId: auth.apiKeyId }),
      }
    : { userId: auth.userId };
}

/** The key's actor, from what authentication resolved; it makes no query. */
function keyActorOf(caller: GateCaller, key: AuthenticatedScope): KeyActor {
  return actorForKey({
    keyId: caller.keyId ?? "",
    userId: caller.userId,
    grants: key.grants ?? [],
    roles: key.roles ?? caller.roles ?? [],
  });
}

/** The caller's actor: a key's from its scope, a user's looked up. */
function actorOf(caller: GateCaller): Promise<Actor> {
  return caller.key
    ? Promise.resolve(keyActorOf(caller, caller.key))
    : actorForUser(caller.userId);
}

/**
 * The verdict for one permission, `action` on `resource`, for the caller the
 * route authenticated.
 */
export function routeGateVerdict(
  auth: AuthContext,
  action: string,
  resource: string,
  rules: RouteRules
): Promise<GateVerdict> {
  return gateVerdict(callerOf(auth), action, resource, rules, () =>
    hasPermission(auth.userId, action, resource)
  );
}

/**
 * The route gate's verdict for one permission. An entity's operation is the
 * collection gate's question; anything else only the permission path answers,
 * as the gate always has, a super-admin first, so the one difference the
 * decision makes there is named.
 */
function gateVerdict(
  caller: GateCaller,
  action: string,
  resource: string,
  rules: RouteRules,
  permissionWithoutService: () => Promise<boolean>
): Promise<GateVerdict> {
  const registered =
    resource === "" ? undefined : rules?.getRegisteredTarget(resource);
  if (!asksTheEntity(action, resource, registered)) {
    return permissionVerdict(caller, action, resource, rules);
  }
  return collectionGateVerdict({
    slug: resource,
    action: action as AccessOperation,
    // A key's rule falls back to the user's roles without its own; a
    // session's roles are looked up, never taken as handed.
    user: caller.key
      ? {
          id: caller.userId,
          ...(caller.roles ? { roles: [...caller.roles] } : {}),
        }
      : { id: caller.userId },
    scope: caller.key,
    principal: null,
    rules,
    permissionWithoutService,
  });
}

/**
 * The verdict for an action no rule can name. A key holds it by its stored
 * slug; a session, with the access-control service, by super-admin authority
 * and then the permission, and without it by the permission alone.
 */
async function permissionVerdict(
  caller: GateCaller,
  action: string,
  resource: string,
  rules: RouteRules
): Promise<GateVerdict> {
  if (caller.key) {
    const actor = keyActorOf(caller, caller.key);
    const today = caller.key.permissions.includes(
      permissionSlug(action, resource)
    );
    // The decision reads the grant's action and resource, which agree with
    // the stored slug unless a grant was stored under a slug of its own; and
    // on a system resource it counts the resource's `manage-` permission.
    const byGrant = holdsPermission(actor, action, resource);
    await deviate("key-slug-string-match", today, () => byGrant);
    await deviate(
      "manage-not-counted",
      byGrant,
      () => decidePermission(actor, action, resource).allowed
    );
    return verdictOf(today);
  }
  const today =
    (rules !== undefined && (await userIsSuperAdmin(caller.userId))) ||
    (await userHoldsPermission(caller.userId, action, resource));
  if (!manageCounts(action, resource)) return verdictOf(today);
  return verdictOf(
    await deviate(
      "manage-not-counted",
      today,
      async () =>
        decidePermission(await actorForUser(caller.userId), action, resource)
          .allowed
    )
  );
}

/**
 * The verdict when any one of several permissions will do. Today a key holds
 * one by its stored slug and a session by its database permissions, and no
 * rule is read for either.
 */
export async function anyPermissionVerdict(
  auth: AuthContext,
  permissions: readonly RoutePermission[],
  rules: RouteRules
): Promise<GateVerdict> {
  const caller = callerOf(auth);
  if (caller.key) {
    const actor = keyActorOf(caller, caller.key);
    const stored = caller.key.permissions;
    const today = permissions.some(({ action, resource }) =>
      stored.includes(permissionSlug(action, resource))
    );
    // Three steps from today's answer to the decision's, each named apart:
    // the grants rather than the stored slugs, then a system resource's
    // `manage-` permission counted, then the targets' rules read.
    const byGrants = permissions.some(({ action, resource }) =>
      holdsPermission(actor, action, resource)
    );
    const byPermission = permissions.some(
      ({ action, resource }) =>
        decidePermission(actor, action, resource).allowed
    );
    await deviate("key-slug-string-match", today, () => byGrants);
    await deviate("manage-not-counted", byGrants, () => byPermission);
    await deviate("any-of-skips-rules", byPermission, () =>
      anyDecided(actor, permissions, rules)
    );
    return verdictOf(today);
  }
  const today = await hasAnyPermission(auth.userId, [...permissions]);
  // The user's actor is resolved only while a test listens, and once.
  let actor: Promise<Actor> | undefined;
  const userActor = () => (actor ??= actorForUser(auth.userId));
  const byPermission = async () => {
    const resolved = await userActor();
    return permissions.some(
      ({ action, resource }) =>
        decidePermission(resolved, action, resource).allowed
    );
  };
  await deviate("manage-not-counted", today, byPermission);
  // Named only where reading the rules moves the answer past the permissions:
  // the comparison is made against today's answer, so a difference the
  // permissions alone explain is reported as "agrees" here.
  await deviate("any-of-skips-rules", today, async () => {
    const decided = await anyDecided(await userActor(), permissions, rules);
    return decided === (await byPermission()) ? today : decided;
  });
  return verdictOf(today);
}

/** Whether the decision allows any one of the permissions. */
async function anyDecided(
  actor: Actor,
  permissions: readonly RoutePermission[],
  rules: RouteRules
): Promise<boolean> {
  for (const { action, resource } of permissions) {
    if (await decidedOne(actor, action, resource, rules)) return true;
  }
  return false;
}

/**
 * The decision's answer for one permission: an entity's operation asked of
 * the target with the rules it declares, whether or not the access-control
 * service is there to read them, and anything else of the permission alone,
 * as {@link gateVerdict} routes them.
 */
async function decidedOne(
  actor: Actor,
  action: string,
  resource: string,
  rules: RouteRules
): Promise<boolean> {
  const declared =
    resource === ""
      ? undefined
      : (declaredTarget(resource) ?? rules?.getRegisteredTarget(resource));
  if (!asksTheEntity(action, resource, declared)) {
    return decidePermission(actor, action, resource).allowed;
  }
  const target: AccessTarget = declared ?? {
    kind: "collection",
    slug: resource,
  };
  return (await decide(actor, action as AccessOperation, target)).allowed;
}

/**
 * Whether this caller may perform `action` on `resource`, whichever way they
 * authenticated: a plugin route's `ctx.caller.can(action, resource)`, and the
 * dashboard's checks of a widget's reader.
 *
 * The route gate's question asked of the caller, `scope` when a key made the
 * request: a key is judged on its own scope, never its owner's grants, and a
 * super-admin does not bypass that scope. Three answers it has always given
 * apart from the gate are kept through named deviations: an empty action or
 * resource refused, a signed-in user refused without the access-control
 * service, and a rule's own answer handed back as it came.
 *
 * `action` is a plain string rather than the operation union, because a
 * permission's action is not bounded by those six: `export-submissions` and
 * `manage-settings` are both real grants.
 */
export async function callerMayPerform(
  scope: AuthenticatedScope | undefined,
  action: string,
  resource: string,
  user: { id: string; roles?: readonly string[] }
): Promise<boolean> {
  if (!user.id) return false;
  const rules = getRBACService();
  const caller: GateCaller =
    scope?.actorType === "apiKey"
      ? {
          userId: user.id,
          key: scope,
          ...(user.roles ? { roles: user.roles } : {}),
        }
      : { userId: user.id };
  if (!action || !resource) return refusedEmpty(caller, action, resource);
  if (!caller.key) return sessionAnswer(caller.userId, action, resource, rules);
  // A key is judged on its own scope, the route gate's way, with or without
  // the service.
  return (
    await gateVerdict(caller, action, resource, rules, () =>
      Promise.resolve(false)
    )
  ).allowed;
}

/**
 * Whether the caller holds the permission a slug names, as a dashboard
 * widget's `requiredPermission` and a document lock's release ask it. A key
 * holds it by the stored slug alone; a signed-in user is asked as
 * `ctx.caller.can` asks one.
 */
export async function holdsPermissionAnswer(
  slug: string,
  caller: ReadAccessCaller,
  rules: RouteRules
): Promise<boolean> {
  if (!caller.userId || !slug) return false;
  const { action, resource } = parsePermissionSlug(slug);
  if (caller.authMethod === "api-key") {
    const actor = actorForKey({
      keyId: "",
      userId: caller.userId,
      grants: caller.grants ?? [],
      roles: caller.roles,
    });
    const today = caller.permissions.includes(slug);
    // Three steps from today's answer to the decision's, each named apart:
    // the grant rather than the stored slug, then a system resource's
    // `manage-` permission counted, then the target's rules read.
    const byGrant = holdsPermission(actor, action, resource);
    const byPermission = decidePermission(actor, action, resource).allowed;
    await deviate("key-slug-string-match", today, () => byGrant);
    await deviate("manage-not-counted", byGrant, () => byPermission);
    await deviate("holds-permission-key-skips-rules", byPermission, () =>
      decidedOne(actor, action, resource, rules)
    );
    return today;
  }
  const user: GateCaller = { userId: caller.userId };
  // Refused without the service before the slug is read, as it always was.
  if (!rules) return refusedWithoutService(user, action, resource);
  if (!action || !resource) return refusedEmpty(user, action, resource);
  return sessionAnswer(caller.userId, action, resource, rules);
}

/**
 * A signed-in user's answer to a caller check: the route gate's, refused
 * without the access-control service, and a rule's own answer as it came.
 * A lookup that failed fails the check, as it always has, rather than
 * answering no.
 */
async function sessionAnswer(
  userId: string,
  action: string,
  resource: string,
  rules: RouteRules
): Promise<boolean> {
  const caller: GateCaller = { userId };
  if (!rules) return refusedWithoutService(caller, action, resource);
  const verdict = await gateVerdict(caller, action, resource, rules, () =>
    Promise.resolve(false)
  );
  if (!verdict.allowed && verdict.refusal === "failed") throw verdict.error;
  if (!("ruleAnswer" in verdict)) return verdict.allowed;
  // Typed as the rule declares its answer, a yes or no; a rule that answered
  // anything else has that handed back as it came.
  return deviate(
    "can-returns-raw-rule-value",
    verdict.ruleAnswer as boolean,
    () => verdict.allowed
  );
}

/** An empty action or resource, refused whoever asks. */
function refusedEmpty(
  caller: GateCaller,
  action: string,
  resource: string
): Promise<boolean> {
  return deviate("can-refuses-empty-action-or-resource", false, async () =>
    decidedOne(await actorOf(caller), action, resource, undefined)
  );
}

/** A signed-in user refused for want of the access-control service. */
function refusedWithoutService(
  caller: GateCaller,
  action: string,
  resource: string
): Promise<boolean> {
  return deviate("can-no-service-refuses-people", false, async () =>
    decidedOne(await actorOf(caller), action, resource, undefined)
  );
}

/** A collection the schema list may show, by its slug. */
export interface ListedCollection {
  readonly slug: string;
}

/**
 * The collections among `collections` the schema list shows the caller the
 * route authenticated: those it may read by its permission, in the order
 * given. A key holds the permission by its stored slug and a session by its
 * permissions, a super-admin every one, and no collection's read rule is read.
 *
 * The caller is read once for the whole list, not once per collection: a
 * super-admin by the one cached check, anyone else by their roles and grants.
 */
export async function schemaListed<T extends ListedCollection>(
  auth: AuthContext,
  collections: readonly T[],
  rules: RouteRules
): Promise<T[]> {
  const caller = callerOf(auth);
  if (caller.key) {
    const key = caller.key;
    const actor = keyActorOf(caller, key);
    return keptWhere(collections, slug =>
      readByPermission(
        actor,
        slug,
        rules,
        key.permissions.includes(permissionSlug("read", slug))
      )
    );
  }
  if (await userIsSuperAdmin(caller.userId)) return [...collections];
  let actor: Actor;
  try {
    actor = await actorForUser(caller.userId);
  } catch {
    // A caller whose access cannot be read is shown nothing, as when each
    // collection's permission check failed closed.
    return [];
  }
  return keptWhere(collections, slug =>
    readByPermission(actor, slug, rules, holdsPermission(actor, "read", slug))
  );
}

async function keptWhere<T extends ListedCollection>(
  collections: readonly T[],
  shown: (slug: string) => Promise<boolean>
): Promise<T[]> {
  const kept: T[] = [];
  for (const collection of collections) {
    if (await shown(collection.slug)) kept.push(collection);
  }
  return kept;
}

/**
 * Whether the list shows one collection: today's answer from the permission,
 * with each step to the decision's named apart: the grant rather than a key's
 * stored slug, then the read rule.
 */
async function readByPermission(
  actor: Actor,
  slug: string,
  rules: RouteRules,
  today: boolean
): Promise<boolean> {
  const byPermission = decidePermission(actor, "read", slug).allowed;
  if (actor.kind === "key") {
    await deviate("key-slug-string-match", today, () =>
      holdsPermission(actor, "read", slug)
    );
    await deviate(
      "manage-not-counted",
      holdsPermission(actor, "read", slug),
      () => byPermission
    );
  } else {
    await deviate("manage-not-counted", today, () => byPermission);
  }
  await deviate("schema-list-ignores-rules", byPermission, () =>
    decidedOne(actor, "read", slug, rules)
  );
  return today;
}
