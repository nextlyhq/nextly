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
import type { Principal } from "../../plugins/principals/types";
import type { AccessControlContext } from "../../shared/types/access";

/** What a caller asks to do to a collection entry or a Single. */
export type AccessAction =
  | "create"
  | "read"
  | "update"
  | "delete"
  | "publish"
  | "unpublish";

/**
 * One permission, as its row names it.
 *
 * Kept as its parts rather than its slug alone: the slug's stored spelling
 * (`read-posts`) and the spelling a rule is promised (`posts:read`) are both
 * derived from these, and a slug cannot be split back into parts reliably,
 * since a resource may itself contain a hyphen.
 */
export interface PermissionGrant {
  readonly action: string;
  readonly resource: string;
}

/** Trusted server work, which no decision limits (`overrideAccess: true`). */
export interface SystemActor {
  readonly kind: "system";
}

/**
 * A caller with no session, no key and no plugin person. Its permissions are
 * the Public role's, which grants nothing until that role exists.
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
  /** Holds the super-admin role, directly or through inheritance. */
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
  /** Never true: no key carries super-admin authority, whoever made it. */
  readonly superAdmin: false;
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

export function principalActor(principal: Principal): PrincipalActor {
  return Object.freeze({ kind: "principal", principal });
}

export function userActor(fields: {
  userId: string;
  roles: readonly string[];
  permissions: readonly PermissionGrant[];
  superAdmin: boolean;
}): UserActor {
  return Object.freeze({
    kind: "user",
    userId: fields.userId,
    roles: Object.freeze([...fields.roles]),
    permissions: freezeAll(fields.permissions),
    superAdmin: fields.superAdmin,
  });
}

/**
 * A key's actor. It takes no super-admin flag at all, so no caller can hand a
 * key that authority, whatever role names the key carries from its maker.
 */
export function keyActor(fields: {
  keyId: string;
  userId: string;
  roles: readonly string[];
  permissions: readonly PermissionGrant[];
}): KeyActor {
  return Object.freeze({
    kind: "key",
    keyId: fields.keyId,
    userId: fields.userId,
    roles: Object.freeze([...fields.roles]),
    permissions: freezeAll(fields.permissions),
    superAdmin: false,
  });
}

function freezeAll(
  permissions: readonly PermissionGrant[]
): readonly PermissionGrant[] {
  return Object.freeze(
    permissions.map(({ action, resource }) =>
      Object.freeze({ action, resource })
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

/** The actor's permissions in their stored spelling, `read-posts`. */
export function storedPermissions(actor: Actor): string[] {
  return grantsOf(actor).map(grant => `${grant.action}-${grant.resource}`);
}

/** The actor's permissions in the spelling a rule reads, `posts:read`. */
export function rulePermissions(actor: Actor): string[] {
  return grantsOf(actor).map(grant => `${grant.resource}:${grant.action}`);
}

/** Whether the actor holds super-admin authority. Only a user can. */
export function isSuperAdmin(actor: Actor): boolean {
  return actor.kind === "user" && actor.superAdmin;
}

/**
 * What a collection or Single rule is handed for this actor.
 *
 * A key's rule is handed the user who made the key, as it is today. A
 * visitor and a plugin person are handed no user, and only a plugin person is
 * handed a principal.
 */
export function ruleContext(
  actor: Exclude<Actor, SystemActor>,
  operation: AccessAction,
  slug: string
): AccessControlContext {
  const user =
    actor.kind === "user" || actor.kind === "key" ? { id: actor.userId } : null;
  const roles =
    actor.kind === "user" || actor.kind === "key" ? [...actor.roles] : [];
  return {
    user,
    roles,
    permissions: rulePermissions(actor),
    principal: actor.kind === "principal" ? actor.principal : null,
    operation,
    collection: slug,
  };
}
