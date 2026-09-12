/**
 * Who can end up able to READ a collection they create, declared once.
 *
 * 🔴 Two places need this answer and they must not each carry it. The SEEDERS
 * assign a new collection's freshly created CRUD permissions to roles. The
 * dashboard's onboarding checklist asks the mirror question -- would THIS
 * reader be able to read a collection they create -- to decide whether to offer
 * the "create your first collection" step at all.
 *
 * Restated in the second, the two drift silently and in both directions: if
 * creation began granting the creator, the checklist would go on hiding a step
 * that had become finishable; if an assignment moved to another role, it would
 * offer one that had stopped being. Neither shows up as a failure anywhere --
 * the reader just sees a checklist that is wrong about them.
 *
 * So nothing here restates a recipient. Each route below is COMPUTED from the
 * declaration that owns it. Sharing only a literal was not enough: a previous
 * revision kept the membership test hard-coded as `isSuperAdmin` beside the
 * constant, so moving the recipient would have moved the seeder and left the
 * predicate behind.
 *
 * @module auth/new-entity-access-policy
 */

import { isCreatableCollectionSlug } from "../collections/config/collection-slug-rules";
import { parsePermissionSlug } from "../plugins/routes/permission-slug";
import { listRoleSlugsForUser } from "../services/lib/permissions";

import { presetsGrantingReadOf } from "./role-presets";

/**
 * The role slug a newly seeded entity's permissions are assigned to IMMEDIATELY.
 *
 * `PermissionSeedService.assignNewPermissionsToSuperAdmin` selects the role by
 * it. It is not the only role that ends up holding them -- see
 * {@link rolesThatWouldReadNewCollection} -- but it is the only one that holds
 * them the moment the collection exists.
 */
export const NEW_ENTITY_PERMISSION_ROLE = "super-admin";

/**
 * The name the preset predicates are asked about.
 *
 * They are being asked about a collection nobody has created yet, so one slug
 * has to stand for all of them. That is sound only while the presets are blind
 * to WHICH creatable collection they are shown -- they are today, because the
 * only resources any of them names (`roles`, `permissions`, `users`, `media`)
 * are system resources, and a collection cannot be created under one of those
 * names. Both halves of that are pinned by tests rather than asserted here: the
 * probe must itself be creatable, and the answer must come out the same for
 * several different creatable slugs.
 */
export const NEW_COLLECTION_PROBE_SLUG = "example";

/** How the caller a widget resolver holds is described to this policy. */
export interface NewEntityAccessCaller {
  userId: string;
  /** An API key is judged on the scope stamped into it, never on its owner's roles. */
  isApiKey: boolean;
  /** The key's own stamped permission slugs. Empty for a session caller. */
  permissions: readonly string[];
}

/**
 * Every role that would end up holding `read-<slug>` for a collection created
 * under that slug, by whichever route puts it there.
 *
 * 🔴 There are two routes and only one of them is the creation itself, which is
 * the assumption an earlier revision of this module got wrong.
 *
 * `assignNewPermissionsToSuperAdmin` runs AS the collection is created and
 * assigns its permissions to {@link NEW_ENTITY_PERMISSION_ROLE} alone.
 *
 * `seedRolePresets` runs at every boot and re-resolves each preset's predicate
 * against the permission list as it then stands, so a preset whose rule covers
 * the new collection picks its permissions up on the next start. `admin` is
 * such a preset -- its rule is "everything except escalation", and a content
 * collection is not an escalation resource -- so an admin who is not a super
 * admin does reach the collection they created, one restart later.
 *
 * That delay is why the checklist offers the step rather than hiding it: the
 * step is finishable for them, and a step withheld from someone who can take it
 * is the defect this policy exists to prevent. Asked of the preset predicates
 * rather than answered by a list naming `admin`, so a preset that stops
 * covering new collections stops appearing here without anyone remembering to
 * come back.
 */
export function rolesThatWouldReadNewCollection(
  slug: string = NEW_COLLECTION_PROBE_SLUG
): string[] {
  return [NEW_ENTITY_PERMISSION_ROLE, ...presetsGrantingReadOf(slug)];
}

/**
 * Whether a key's stamped grant names a collection it could create.
 *
 * `canReadEntity` admits an API key on an EXACT `read-<slug>` match, so a grant
 * only makes the step finishable if the caller can go on to create a collection
 * under that exact name. A key stamped `read-settings` cannot: `settings` is a
 * system resource and a collection may not take its name, so that key would
 * create something it still could not read.
 *
 * Whether the name is already TAKEN is not asked, and does not need to be. The
 * step is only offered while it is incomplete, and it is complete as soon as
 * the caller can read any collection -- so a key holding `read-reports` where
 * `reports` already exists has finished the step rather than reached this.
 */
function namesACreatableCollection(grant: string): boolean {
  const { action, resource } = parsePermissionSlug(grant);
  return action === "read" && isCreatableCollectionSlug(resource);
}

/**
 * Whether this caller could end up reading a collection they create.
 *
 * Two routes, because two things can make a not-yet-existing collection
 * readable, and only one of them is the seeding.
 *
 * A SESSION caller reaches it through a seeder: they are in a role that ends up
 * holding the new collection's permissions, immediately or at the next boot.
 * Membership is read from their role slugs against
 * {@link rolesThatWouldReadNewCollection}, which is computed from the seeders'
 * own declarations rather than named here.
 *
 * An API KEY reaches it a different way and must not be refused outright. A
 * key never GAINS a grant -- it is judged on the scope stamped into it when it
 * was minted -- but a permission may be pre-seeded, and `canReadEntity` accepts
 * a key's exact `read-<slug>` grant once that collection exists. So a key
 * stamped `read-reports` can finish the step by creating `reports`, and the
 * step is finishable exactly when it carries a read grant naming a collection
 * it could create.
 */
export async function wouldReadOwnNewCollection(
  caller: NewEntityAccessCaller
): Promise<boolean> {
  if (caller.isApiKey) {
    return caller.permissions.some(namesACreatableCollection);
  }
  const roles = await listRoleSlugsForUser(caller.userId);
  const eligible = rolesThatWouldReadNewCollection();
  return roles.some(role => eligible.includes(role));
}
