/**
 * Who is asking: the one value an access decision is made for.
 *
 * Every way into Nextly names its caller differently today: a session's role
 * ids, an API key's scope, a plugin person, a Direct API `user`, or nobody.
 * An actor is the single shape they all resolve to, so a decision never has
 * to know which way in asked. It carries what a decision reads and nothing it
 * would have to look up: the permissions, the role slugs, and whether the
 * caller holds super-admin authority.
 *
 * An actor is built once and never changed. A narrower caller in the same
 * request, such as a service call made as someone else, is a different actor,
 * so nothing decided for one is ever reused for the other.
 */
import { NextlyError } from "../../errors/nextly-error";
import { isCorePrincipal } from "../../plugins/principals/principal";
import type { Principal } from "../../plugins/principals/types";
import { SUPER_ADMIN_SLUG } from "../../services/access/super-admin";
import type { AccessOperation } from "../../services/access/types";
import type { AccessRuleContext } from "../../shared/types/access";
import type { GrantedPermission } from "../authenticated-scope";

import { manageCounts } from "./manage-bridge";
import { buildRuleContext } from "./rule-context";

/**
 * What a caller asks to do to a collection entry or a Single: the one list of
 * access operations, so an operation added there is one the decision names.
 */
export type AccessAction = AccessOperation;

/**
 * One permission, as its row names it: its stored slug, and the action and
 * resource it grants.
 *
 * The slug is kept as stored rather than rebuilt from the two parts, since a
 * permission's slug may differ from `<action>-<resource>` (`manage-api-keys`
 * grants `update` on `api-keys`), and a slug cannot be split back into parts
 * reliably, since a resource may itself contain a hyphen.
 */
export type PermissionGrant = GrantedPermission;

/** Trusted server work, which no decision limits (`overrideAccess: true`). */
export interface SystemActor {
  readonly kind: "system";
}

/**
 * A caller with no session, no key and no plugin person. Its permissions are
 * the Public role's, which grants nothing until boot seeding has made it.
 */
export interface VisitorActor {
  readonly kind: "visitor";
  readonly permissions: readonly PermissionGrant[];
}

/** A plugin-defined signed-in person, who holds no role and no permission. */
export interface PrincipalActor {
  readonly kind: "principal";
  readonly principal: Principal;
}

/** A signed-in staff user. */
export interface UserActor {
  readonly kind: "user";
  readonly userId: string;
  /** Role slugs, inherited roles included. */
  readonly roles: readonly string[];
  readonly permissions: readonly PermissionGrant[];
  /**
   * Holds the super-admin role, directly or through inheritance: whether
   * `roles` names it, worked out when the actor is made.
   */
  readonly superAdmin: boolean;
}

/** An API key, acting for the user who made it. */
export interface KeyActor {
  readonly kind: "key";
  readonly keyId: string;
  /** The user who made the key, whom a rule is handed as `user`. */
  readonly userId: string;
  readonly roles: readonly string[];
  readonly permissions: readonly PermissionGrant[];
  /**
   * Carries its maker's super-admin authority: true only for a full-access key
   * whose maker is an active super-admin for this request, as authentication
   * found it. Never from the role names the key carries, and never for a key
   * whose scope was narrowed.
   */
  readonly superAdmin: boolean;
}

export type Actor =
  | SystemActor
  | VisitorActor
  | PrincipalActor
  | UserActor
  | KeyActor;

const SYSTEM: SystemActor = Object.freeze({ kind: "system" });

export function systemActor(): SystemActor {
  return SYSTEM;
}

export function visitorActor(
  permissions: readonly PermissionGrant[] = []
): VisitorActor {
  return Object.freeze({
    kind: "visitor",
    permissions: freezeAll(permissions),
  });
}

/**
 * A plugin person's actor, for a principal core made. A person's access comes
 * from rules alone, and the principal's public shape can be built by anyone,
 * so a principal core did not make, or a copy of one, is refused here rather
 * than trusted by whichever way in hands it over.
 */
export function principalActor(principal: Principal): PrincipalActor {
  // Read before the check, which narrows a refused principal to nothing.
  const { kind } = principal;
  if (!isCorePrincipal(principal)) {
    throw NextlyError.internal({
      logContext: { reason: "principal-not-made-by-core", kind },
    });
  }
  return Object.freeze({ kind: "principal", principal });
}

export function userActor(fields: {
  userId: string;
  roles: readonly string[];
  permissions: readonly PermissionGrant[];
}): UserActor {
  return Object.freeze({
    kind: "user",
    userId: fields.userId,
    roles: Object.freeze([...fields.roles]),
    permissions: freezeAll(fields.permissions),
    // Read from the role set it was resolved with, never handed in apart
    // from it, so the two cannot disagree.
    superAdmin: fields.roles.includes(SUPER_ADMIN_SLUG),
  });
}

/**
 * A key's actor. Its super-admin authority is what authentication found for
 * the key, handed in by the one resolver that reads it; the role names the
 * key carries from its maker never give it.
 */
export function keyActor(fields: {
  keyId: string;
  userId: string;
  roles: readonly string[];
  permissions: readonly PermissionGrant[];
  superAdmin: boolean;
}): KeyActor {
  return Object.freeze({
    kind: "key",
    keyId: fields.keyId,
    userId: fields.userId,
    roles: Object.freeze([...fields.roles]),
    permissions: freezeAll(fields.permissions),
    superAdmin: fields.superAdmin,
  });
}

function freezeAll(
  permissions: readonly PermissionGrant[]
): readonly PermissionGrant[] {
  return Object.freeze(
    permissions.map(({ slug, action, resource }) =>
      Object.freeze({ slug, action, resource })
    )
  );
}

/** The permissions an actor holds; none for system work and plugin people. */
function grantsOf(actor: Actor): readonly PermissionGrant[] {
  return actor.kind === "system" || actor.kind === "principal"
    ? []
    : actor.permissions;
}

/** Whether the actor holds the permission to `action` on `resource`. */
export function holdsPermission(
  actor: Actor,
  action: string,
  resource: string
): boolean {
  return grantsOf(actor).some(
    grant => grant.action === action && grant.resource === resource
  );
}

// Decided in a leaf module of its own, which the admin's copy is held to.
export { manageCounts } from "./manage-bridge";

/**
 * Whether the actor holds `action` on a system resource through that
 * resource's `manage-` permission alone ({@link manageCounts}).
 */
export function holdsByManage(
  actor: Actor,
  action: string,
  resource: string
): boolean {
  return (
    manageCounts(action, resource) && holdsPermission(actor, "manage", resource)
  );
}

/** The actor's permissions as their rows store them, `read-posts`. */
export function storedPermissions(actor: Actor): string[] {
  return grantsOf(actor).map(grant => grant.slug);
}

/**
 * Whether the actor holds super-admin authority: a super-admin person, or a
 * full-access key whose maker is one. What is kept for a person asks whether
 * the caller is a person, never this, so no key reaches it.
 */
export function isSuperAdmin(actor: Actor): boolean {
  return (actor.kind === "user" || actor.kind === "key") && actor.superAdmin;
}

/**
 * What a collection or Single rule is handed for this actor, built by the
 * one rule-context builder every rule is asked through.
 *
 * A key's rule is handed the user who made the key, as it is today. A
 * visitor and a plugin person are handed no user, and only a plugin person is
 * handed a principal. A visitor's rule is handed the permissions the visitor
 * holds, which are the Public role's, so a rule that reads the caller's
 * permissions answers a visitor by what Public grants.
 */
export function ruleContext(
  actor: Exclude<Actor, SystemActor>,
  operation: AccessAction,
  target: { readonly kind: "collection" | "single"; readonly slug: string }
): AccessRuleContext {
  const staff = actor.kind === "user" || actor.kind === "key";
  return buildRuleContext(
    {
      user: staff ? { id: actor.userId } : null,
      roles: staff ? actor.roles : [],
      permissions: grantsOf(actor),
      principal: actor.kind === "principal" ? actor.principal : null,
    },
    { operation, target: { kind: target.kind, slug: target.slug } }
  );
}
