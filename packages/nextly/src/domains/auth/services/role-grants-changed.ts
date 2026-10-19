/**
 * What follows a committed change to what a role grants.
 *
 * One place for every change to a role's grants (its permissions, the roles
 * it inherits, the role itself deleted), so none of them can do one half and
 * forget the other: the cached answers built from the old grants are retired,
 * and the scheduled releases are checked again for a member whose author may
 * no longer publish or unpublish it, and stopped now rather than at their
 * instant. Every scheduled release is checked, because the users a role
 * reaches through inheritance are not recorded anywhere this could ask.
 *
 * @module domains/auth/services/role-grants-changed
 */
import { invalidatePermissionCache } from "../../../services/lib/permissions";
import { stopReleasesHolding } from "../../releases/early-stop";

/** Call once the change to `roleId`'s grants has committed. */
export async function afterRoleGrantsChanged(roleId: string): Promise<void> {
  // The cache first, so the checks below judge the grants as they now are.
  await invalidatePermissionCache({ roleId });
  await stopReleasesHolding({ everyScheduled: true });
}
