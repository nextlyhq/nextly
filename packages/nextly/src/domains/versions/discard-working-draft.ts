/**
 * Discarding a document's pending working draft.
 *
 * The draft/published split stores a status-less edit of a published document
 * as a working-draft sidecar in `nextly_versions`. Discarding removes that
 * sidecar and hands back the live published row, so the editor resets to what
 * is public. Durable history is never touched — this reverts unpublished edits,
 * it does not rewrite a version.
 *
 * Authorization is the caller's concern: the dispatcher handler establishes
 * read and update on the document before calling in here, so this module only
 * performs the removal and the re-read.
 *
 * @module domains/versions/discard-working-draft
 */

import type { AuthenticatedScope } from "../../auth/authenticated-scope";
import { getService } from "../../di";
import type { UserContext } from "../singles/types";

export interface DiscardWorkingDraftArgs {
  /** Collection slug. The split is a collection feature, so there is no Single
   *  variant: a Single has a single row, not a published/draft pair. */
  slug: string;
  entryId: string;
  user: UserContext;
  /**
   * The caller's authenticated scope, forwarded to the re-read so a scoped API
   * key is judged on its OWN read grant rather than the key owner's roles.
   */
  authenticatedScope?: AuthenticatedScope;
}

/**
 * Remove the working-draft sidecar for a published collection entry and return
 * the live published document as a plain read would shape it. A no-op that
 * still returns the live row when no working draft exists.
 */
export async function discardWorkingDraft(
  args: DiscardWorkingDraftArgs
): Promise<unknown> {
  // Remove the sidecar. The split stores the working draft under the null
  // locale key (it applies only to non-localized collections), so that is the
  // one to clear. Deleting when none exists is a no-op, not an error.
  await getService("versionsService").deleteWorkingDraft(
    { scopeKind: "collection", scopeSlug: args.slug, entryId: args.entryId },
    null
  );

  // Re-read the now-authoritative published row through the full read pipeline
  // (hooks, redaction, field-level access), without the working-draft overlay,
  // so the response is the live document the editor resets to.
  const result = await getService("collectionsHandler").getEntry({
    collectionName: args.slug,
    entryId: args.entryId,
    user: args.user,
    // Read and update were established by the caller; skip only the redundant
    // coarse RBAC re-check while the document's own rules still run in getEntry.
    routeAuthorized: true,
    authenticatedScope: args.authenticatedScope,
    status: "all",
  });
  return result.data;
}
