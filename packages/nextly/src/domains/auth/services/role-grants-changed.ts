/**
 * What follows a committed change to what a role grants.
 *
 * One place for every change to a role's grants (its permissions, the roles
 * it inherits, the slug a code-defined rule reads, the role itself deleted),
 * so none of them can do one half and forget the other: the cached answers
 * built from the old grants are retired, and the scheduled releases are
 * checked again for a member whose author may no longer publish or unpublish
 * it, and stopped now rather than at their instant. Every scheduled release is checked, because the users a role
 * reaches through inheritance are not recorded anywhere this could ask.
 *
 * A permission whose action, resource or slug is edited changes what every
 * role holding it grants, so it takes the same re-check.
 *
 * Every such writer runs inside {@link changingRoleGrants}, which queues the
 * content expiry the change owes before the write starts, so it is owed in the
 * database before the change commits; `role-grants-gate.test.ts` holds every
 * call to {@link afterRoleGrantsChanged} to that.
 *
 * @module domains/auth/services/role-grants-changed
 */
import { invalidatePermissionCache } from "../../../services/lib/permissions";
import { aheadOfGrantsChange } from "../../flush-content-change";
import { stopReleasesHolding } from "../../releases/early-stop";

/**
 * Runs `write`, a change to what one or more roles grant that ends by calling
 * {@link afterRoleGrantsChanged} for each role it changed, with the content
 * expiry that change owes queued first (`aheadOfGrantsChange`). A writer that
 * finds nothing to change and calls nothing has its queued row withdrawn; one
 * that throws leaves it, for one expiry more.
 */
export function changingRoleGrants<T>(write: () => Promise<T>): Promise<T> {
  return aheadOfGrantsChange(write);
}

/**
 * Call once the change to `roleId`'s grants has committed. A caller changing
 * many roles in one pass may leave out the release check
 * (`recheckReleases: false`) and run `afterGrantsChanged` once after the last,
 * so scheduled releases are checked once rather than once a role.
 */
export async function afterRoleGrantsChanged(
  roleId: string,
  options: { recheckReleases?: boolean } = {}
): Promise<void> {
  // The cache first, so the checks below judge the grants as they now are.
  await invalidatePermissionCache({ roleId });
  if (options.recheckReleases !== false) await afterGrantsChanged();
}

/**
 * Call once a change to what some role grants has committed and the cached
 * answers built from it are retired: every scheduled release is checked again.
 * Never throws (`stopReleasesHolding`).
 */
export async function afterGrantsChanged(): Promise<void> {
  await stopReleasesHolding({ everyScheduled: true });
}
