/**
 * The REST route gates' answers, asked of the one decision.
 *
 * A route gate judges the caller a request authenticated, a session or an API
 * key, against one permission (`requirePermission`, `requireCollectionAccess`,
 * a plugin route's `requiredPermission`) or any of several
 * (`requireAnyPermission`). Each keeps the answer it has always given: where
 * that differs from the decision's, it is kept through a named deviation
 * (`./deviations`), so no answer changes and every difference that remains is
 * one of those names.
 *
 * One permission on an access operation is the collection gate's question
 * asked of the route's caller, so it is answered by the collection gate's
 * adapter: the two have always run the same steps for a session and a key.
 * A plugin's person never reaches a route gate, so none is asked here.
 */
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
import type { AuthContext } from "../middleware";

import {
  holdsPermission,
  manageCounts,
  type Actor,
  type KeyActor,
} from "./actor";
import { decide, decidePermission } from "./decide";
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

/** The key's own scope, when the request authenticated with one. */
function keyScopeOf(auth: AuthContext): AuthenticatedScope | undefined {
  return auth.authMethod === "api-key" ? apiKeyScopeFrom(auth) : undefined;
}

/** The key's actor, from what authentication resolved; it makes no query. */
function keyActorOf(auth: AuthContext): KeyActor {
  return actorForKey({
    keyId: auth.apiKeyId ?? "",
    userId: auth.userId,
    grants: auth.grants ?? [],
    roles: auth.roles,
  });
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
  // A route naming no resource (`requiredPermission: "manage"`) asks about
  // nothing a rule or a permission row can name; only the permission path
  // answers it as the gate always has, a super-admin first. A system resource
  // a `manage-` permission still counts on declares no rule either, and goes
  // the same way, so the one difference the decision makes there is named.
  if (
    !isAccessOperation(action) ||
    resource === "" ||
    manageCounts(action, resource)
  ) {
    return permissionVerdict(auth, action, resource, rules);
  }
  return collectionGateVerdict({
    slug: resource,
    action,
    user: { id: auth.userId },
    scope: keyScopeOf(auth),
    principal: null,
    rules,
    permissionWithoutService: () =>
      hasPermission(auth.userId, action, resource),
  });
}

/**
 * The verdict for an action no rule can name. A key holds it by its stored
 * slug; a session, with the access-control service, by super-admin authority
 * and then the permission, and without it by the permission alone.
 */
async function permissionVerdict(
  auth: AuthContext,
  action: string,
  resource: string,
  rules: RouteRules
): Promise<GateVerdict> {
  if (auth.authMethod === "api-key") {
    const actor = keyActorOf(auth);
    const today = auth.permissions.includes(permissionSlug(action, resource));
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
    (rules !== undefined && (await userIsSuperAdmin(auth.userId))) ||
    (await userHoldsPermission(auth.userId, action, resource));
  if (!manageCounts(action, resource)) return verdictOf(today);
  return verdictOf(
    await deviate(
      "manage-not-counted",
      today,
      async () =>
        decidePermission(await actorForUser(auth.userId), action, resource)
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
  if (auth.authMethod === "api-key") {
    const actor = keyActorOf(auth);
    const today = permissions.some(({ action, resource }) =>
      auth.permissions.includes(permissionSlug(action, resource))
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

/**
 * Whether the decision allows any one of the permissions, each asked of the
 * target's rules where the target registered some for that action.
 */
async function anyDecided(
  actor: Actor,
  permissions: readonly RoutePermission[],
  rules: RouteRules
): Promise<boolean> {
  for (const { action, resource } of permissions) {
    const target =
      resource === "" ? undefined : rules?.getRegisteredTarget(resource);
    const allowed =
      target && isAccessOperation(action)
        ? (await decide(actor, action, target)).allowed
        : decidePermission(actor, action, resource).allowed;
    if (allowed) return true;
  }
  return false;
}
