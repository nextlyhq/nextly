/**
 * Who can end up able to READ a collection they create, declared once.
 *
 * 🔴 Two places need this answer and they must not each carry it. The SEEDER
 * assigns a new collection's freshly created CRUD permissions to one role. The
 * dashboard's onboarding checklist asks the mirror question -- would THIS
 * reader be able to read a collection they create -- to decide whether to offer
 * the "create your first collection" step at all.
 *
 * Restated in the second, the two drift silently and in both directions: if
 * creation began granting the creator, the checklist would go on hiding a step
 * that had become finishable; if the assignment moved to another role, it would
 * offer one that had stopped being. Neither shows up as a failure anywhere --
 * the reader just sees a checklist that is wrong about them.
 *
 * So the recipient is named ONCE below and the predicate is computed FROM it.
 * Sharing only the literal was not enough: a previous revision kept the
 * membership test hard-coded as `isSuperAdmin` beside the constant, so moving
 * the recipient would have moved the seeder and left the predicate behind.
 *
 * @module auth/new-entity-access-policy
 */

import { listRoleSlugsForUser } from "../services/lib/permissions";

/**
 * The role slug a newly seeded entity's permissions are assigned to.
 *
 * `PermissionSeedService.assignNewPermissionsToSuperAdmin` selects the role by
 * it, and {@link wouldReadOwnNewCollection} tests membership of it.
 */
export const NEW_ENTITY_PERMISSION_ROLE = "super-admin";

/** How the caller a widget resolver holds is described to this policy. */
export interface NewEntityAccessCaller {
  userId: string;
  /** An API key is judged on the scope stamped into it, never on its owner's roles. */
  isApiKey: boolean;
  /** The key's own stamped permission slugs. Empty for a session caller. */
  permissions: readonly string[];
}

/**
 * Whether this caller could end up reading a collection they create.
 *
 * Two routes, because two things can make a not-yet-existing collection
 * readable, and only one of them is the seeding.
 *
 * A SESSION caller reaches it through the seeding: they hold
 * {@link NEW_ENTITY_PERMISSION_ROLE}, so the permissions the seeder assigns
 * land on a role they are in. Membership is read from their role slugs rather
 * than through a named super-admin test, so the constant above is genuinely
 * the single point of change.
 *
 * An API KEY reaches it a different way and must not be refused outright. A
 * key never GAINS a grant -- it is judged on the scope stamped into it when it
 * was minted -- but a permission may be pre-seeded, and `canReadEntity` accepts
 * a key's exact `read-<slug>` grant once that collection exists. So a key
 * stamped `read-reports` can finish the step by creating `reports`, and the
 * step is finishable exactly when it carries some read grant to create into.
 */
export async function wouldReadOwnNewCollection(
  caller: NewEntityAccessCaller
): Promise<boolean> {
  if (caller.isApiKey) {
    return caller.permissions.some(slug => slug.startsWith("read-"));
  }
  const roles = await listRoleSlugsForUser(caller.userId);
  return roles.includes(NEW_ENTITY_PERMISSION_ROLE);
}
