/**
 * Access gate for minting a preview link.
 *
 * A preview token is a bearer credential: whoever holds it reads the entry it
 * names, with no session of their own, and the runtime consumes it with
 * `draft: true` and `overrideAccess: true`. So minting must authorize the view
 * the token will actually hand out, not a weaker one that happens to be easier
 * to ask for.
 *
 * Two questions, because the token's view needs both and they are decided by
 * different rules:
 *
 * 1. **May this caller read this entry at all** — including one that has never
 *    been published, which is the case previews exist for.
 * 2. **May this caller edit this entry** — which is what the draft overlay
 *    itself requires before surfacing a working draft.
 *
 * Both are asked through `collectionsHandler`, the instance that actually
 * serves collection reads and writes, so a verdict here is the verdict the real
 * operation would reach. This mirrors `api/versions-access.ts`, which gates
 * version history the same way and for the same reason.
 *
 * @module api/preview-access
 */

import type { AuthenticatedScope } from "../auth/authenticated-scope";
import { getService } from "../di";
import type { UserContext } from "../domains/singles/types";
import { NextlyError } from "../errors/nextly-error";

/**
 * Turn a read outcome into a verdict, keeping "denied" and "could not ask"
 * apart.
 *
 * A 403 or 404 is an answer: this caller does not get this row, and the two are
 * deliberately collapsed because telling them apart would reveal which entry ids
 * exist. Any other failure is the read itself breaking, and reporting that as an
 * ordinary denial would hide an outage behind a permission error.
 */
function readVerdict(success: boolean, statusCode: number): boolean {
  if (success) return true;
  if (statusCode === 403 || statusCode === 404) return false;
  throw NextlyError.internal({
    logContext: {
      reason: "preview-mint-probe-failed",
      statusCode,
    },
  });
}

/**
 * Confirm the caller may be handed a preview link for this entry.
 *
 * Throws `forbidden` when they may not, with the same answer for a row hidden by
 * a rule, an id that matches nothing, and an entry the caller may read but not
 * edit. Those are different reasons and one answer on purpose: a caller who is
 * refused a link learns only that they are refused.
 *
 * @throws {NextlyError} `forbidden` when no link may be minted.
 */
export async function assertEntryPreviewable(
  collection: string,
  entryId: string,
  user: UserContext,
  actor?: AuthenticatedScope
): Promise<void> {
  const collections = getService("collectionsHandler");

  // Enforced and as the caller, which is the same evaluation the bearer's read
  // will face. `status: "all"` is the part a plain by-id read cannot express: a
  // status-enabled collection otherwise filters to published only, so an entry
  // that has never been published reports as missing — exactly the entry an
  // editor most wants to share for review.
  const read = await collections.getEntry({
    collectionName: collection,
    entryId,
    depth: 0,
    overrideAccess: false,
    user,
    authenticatedScope: actor,
    status: "all",
  });

  if (!readVerdict(read.success, read.statusCode)) {
    throw NextlyError.forbidden({
      logContext: {
        reason: "preview-link-entry-not-visible",
        collection,
        entryId,
      },
    });
  }

  // The token's view is the DRAFT, and the draft overlay surfaces a pending
  // working draft only to a caller trusted to edit the document. Reading the
  // published row proves nothing about that: where a collection allows broad
  // reads but restricts updates per row, a caller can read another author's
  // published entry and would otherwise mint a credential exposing that
  // author's unpublished edits.
  //
  // `routeAuthorized: false` deliberately. The mint route authorized `update`
  // on the COLLECTION, which is one granularity coarser than this question, so
  // the gate is asked to run in full rather than told it already ran. The
  // caller's identity and key scope are supplied, so a scoped API key is judged
  // on its own grant here as well and re-running costs a verdict, not a
  // rejection.
  const mayEdit = await collections.canUpdateEntry({
    collectionName: collection,
    entryId,
    user,
    routeAuthorized: false,
    authenticatedScope: actor,
  });

  if (!mayEdit) {
    throw NextlyError.forbidden({
      logContext: {
        reason: "preview-link-draft-not-editable",
        collection,
        entryId,
      },
    });
  }
}
