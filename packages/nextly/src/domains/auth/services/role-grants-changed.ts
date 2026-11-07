/**
 * What follows a committed change to what a role grants.
 *
 * One place for every change to a role's grants (its permissions, the roles
 * it inherits, the slug a code-defined rule reads, the role itself deleted),
 * so none of them can do one part and forget another: the cached answers
 * built from the old grants are retired; the cached content reads expire, as
 * what a read returns can change with what its reader may read; and the
 * scheduled releases are checked again for a member whose author may no
 * longer publish or unpublish it, and stopped now rather than at their
 * instant. Every scheduled release is checked, because the users a role
 * reaches through inheritance are not recorded anywhere this could ask.
 *
 * A permission whose action, resource or slug is edited changes what every
 * role holding it grants, so it takes the same steps.
 *
 * @module domains/auth/services/role-grants-changed
 */
import { languageChangeContentCache } from "../../../di/registrations/language-change-content-cache";
import { getNextlyLogger } from "../../../observability/logger";
import { invalidatePermissionCache } from "../../../services/lib/permissions";
import { flushEveryContentScope } from "../../flush-content-change";
import { stopReleasesHolding } from "../../releases/early-stop";

/**
 * Call once the change to `roleId`'s grants has committed. A caller changing
 * many roles in one pass may leave out the steps every change shares
 * (`recheckReleases: false`) and run `afterGrantsChanged` once after the last,
 * so the content reads expire and scheduled releases are checked once rather
 * than once a role.
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
 * answers built from it are retired: the cached content reads expire, and
 * every scheduled release is checked again. Never throws.
 */
export async function afterGrantsChanged(): Promise<void> {
  await expireContentReads();
  await stopReleasesHolding({ everyScheduled: true });
}

/**
 * Expires the cached reads of every collection and Single.
 *
 * A cached public read holds what the Public role let a visitor read when it
 * ran, and a read cached for a role holds what that role let it read; a
 * change to a role's grants writes no content, so no write expires either.
 * Every scope rather than the ones the change names: whichever role changed
 * may be Public, a read embeds the collections it relates to as its reader may
 * read them, and a role's inherited grants change with its parents'. A
 * failure is logged: the change has committed, and the reads refresh at the
 * end of their lifetime.
 */
async function expireContentReads(): Promise<void> {
  try {
    await flushEveryContentScope(languageChangeContentCache());
  } catch (error) {
    getNextlyLogger().warn({
      kind: "grants-change-content-expiry-failed",
      message: `A role's grants changed, but cached pages could not be refreshed: ${
        error instanceof Error ? error.message : String(error)
      }. They show the change at the end of their cache lifetime.`,
    });
  }
}
