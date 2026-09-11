/**
 * The dispatcher's resolved identity, in the shape the shared read decision
 * takes.
 *
 * `canReadEntity` and `readableEntities` are the one answer to "may this
 * caller read that entity" — the dashboard scope, the version reads and the
 * list endpoints all ask it, so that a collection authorised entirely in code
 * is visible on every one of them or on none. This is the bridge from a
 * dispatcher request to that answer, kept in one place so no handler builds
 * its own caller and quietly asks a different question.
 *
 * 🔴 An API key is read from the scope the route handler PINNED for the
 * request, not rebuilt from the route params. The params are a lossy copy:
 * they carry the stored permission slugs and neither the key's own roles —
 * serialised only for the methods `ROLE_AWARE_READ_METHODS` names, which the
 * list reads are not — nor the grant rows a rule's `resource:action` spelling
 * is derived from. A caller rebuilt from them let a code rule deciding on
 * `roles`, or checking `permissions.includes("posts:read")`, refuse a key the
 * detail route had just admitted. The pinned scope holds all of it.
 *
 * The params remain the fallback for a transport that pins nothing — a direct
 * dispatch in a test, or one not yet wired through the route handler — and are
 * exactly as lossy there as they always were. A session caller carries no
 * grants either way; `canReadEntity` resolves theirs from the database.
 *
 * @module dispatcher/handlers/read-access-caller
 */

import { ruleFacingPermissions } from "../../auth/authenticated-scope";
import { currentCallerScope } from "../../auth/caller-scope";
import type { ReadAccessCaller } from "../../auth/entity-read-access";
import type { UserContext } from "../../domains/singles/types";
import type { Params } from "../types";

export function readAccessCallerForDispatch(
  p: Params,
  user: UserContext
): ReadAccessCaller {
  const pinned = currentCallerScope();
  if (pinned?.actorType === "apiKey") {
    return {
      userId: user.id,
      authMethod: "api-key",
      permissions: [...pinned.permissions],
      ...(pinned.grants
        ? { rulePermissions: ruleFacingPermissions(pinned) }
        : {}),
      roles: [...(pinned.roles ?? user.roles ?? [])],
    };
  }

  const isApiKey = p._authenticatedActorType === "apiKey";
  let permissions: string[] = [];
  if (isApiKey && p._authenticatedPermissions) {
    try {
      const parsed: unknown = JSON.parse(String(p._authenticatedPermissions));
      if (Array.isArray(parsed)) permissions = parsed as string[];
    } catch {
      // A corrupt value must not read as a broader grant than the key holds;
      // an empty list denies, which is the safe direction.
      permissions = [];
    }
  }

  return {
    userId: user.id,
    authMethod: isApiKey ? "api-key" : "session",
    permissions,
    roles: user.roles ?? [],
  };
}
