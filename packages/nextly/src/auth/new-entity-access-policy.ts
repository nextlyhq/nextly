/**
 * Who receives a newly created entity's permissions, declared once.
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
 * @module auth/new-entity-access-policy
 */

/**
 * The role slug a newly seeded entity's permissions are assigned to.
 *
 * Read by `PermissionSeedService.assignNewPermissionsToSuperAdmin`, which
 * performs the assignment, and by {@link wouldReadOwnNewCollection}, which
 * answers whether a given caller is on the receiving end of it.
 */
export const NEW_ENTITY_PERMISSION_ROLE = "super-admin";

/**
 * Whether this caller would hold read on a collection they create.
 *
 * Derived from the policy above rather than asserted beside it: the seeding
 * assigns to {@link NEW_ENTITY_PERMISSION_ROLE}, so the question is whether
 * this caller holds that role, and `isSuperAdmin` is the membership test for it
 * -- it resolves role inheritance, which a flat slug comparison would miss.
 *
 * An API KEY is never on the receiving end, whoever owns it: a key is judged on
 * the scope stamped into it when it was minted, and a role gaining a permission
 * afterwards does not widen a key that was already issued.
 */
export async function wouldReadOwnNewCollection(
  isSuperAdmin: (userId: string) => Promise<boolean>,
  caller: { userId: string; isApiKey: boolean }
): Promise<boolean> {
  if (caller.isApiKey) return false;
  return isSuperAdmin(caller.userId);
}
