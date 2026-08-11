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
import { errorFromServiceEnvelope } from "../errors/from-service-envelope";
import { NextlyError } from "../errors/nextly-error";

/**
 * Turn a read outcome into a verdict, keeping "denied" and "could not ask"
 * apart.
 *
 * A 403 or 404 is an answer: this caller does not get this row, and the two are
 * deliberately collapsed because telling them apart would reveal which entry ids
 * exist.
 *
 * Anything else is the read failing rather than refusing, and it keeps the
 * status the service gave it. Flattening every other outcome to 500 would erase
 * what the caller needs to act on — a rate limit's 429 and its retry interval
 * become an opaque server error, and a validation failure loses its field
 * detail. The shared converter rebuilds the service's own error, which is what
 * the Direct API boundary does with the same envelope.
 */
function readVerdict(read: {
  success: boolean;
  statusCode: number;
  code?: string;
  message?: string;
  messageKey?: string;
  publicData?: unknown;
}): boolean {
  if (read.success) return true;
  if (read.statusCode === 403 || read.statusCode === 404) return false;
  throw errorFromServiceEnvelope(
    { ...read, message: read.message ?? "Preview authorization read failed" },
    { reason: "preview-mint-probe-failed" }
  );
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

  if (!readVerdict(read)) {
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
  // Which row was actually read, taken from the returned document — and refused
  // when it cannot be established.
  //
  // `read.data` is PRESENTATION data: it has been through `afterRead`, which the
  // service explicitly allows to reshape the row, `id` included. So a missing or
  // non-scalar `id` does not mean "the request id was used" — it means the row
  // that was read is unknown here.
  //
  // Falling back to the requested id would authorize a row that was never read:
  // a `beforeOperation` hook mapping A to B, plus an `afterRead` hook dropping
  // `id`, yields read(B) with update(A) while the token delivers B. Refusing is
  // the only answer available that cannot be wrong, so an unidentifiable row
  // yields no link rather than a link checked against the wrong row.
  const readRow: unknown = read.data;
  const resolvedId =
    readRow !== null &&
    typeof readRow === "object" &&
    "id" in readRow &&
    (typeof readRow.id === "string" || typeof readRow.id === "number")
      ? String(readRow.id)
      : null;

  if (resolvedId === null) {
    throw NextlyError.forbidden({
      logContext: {
        reason: "preview-link-row-unidentifiable",
        collection,
        entryId,
      },
    });
  }

  const mayEdit = await collections.canUpdateEntry({
    collectionName: collection,
    entryId: resolvedId,
    user,
    routeAuthorized: true,
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
