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

import { getService } from "../di";
import {
  previewCallerAuthorized,
  type AuthorizedPreviewCaller,
} from "../domains/collections/services/preview-redirect-resolver";
import {
  singleDocumentEditable,
  singleDocumentReadable,
} from "../domains/singles/services/single-document-access";
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
  options: {
    /**
     * Whether the CALLER has already passed the coarse RBAC / code-defined
     * access gate for `update` on this collection.
     *
     * Required, and per call site rather than defaulted, because it is true for
     * one caller and false for the other and the wrong answer is silent. The
     * mint runs behind `requireRouteCollectionAccess(req, "update", collection)`
     * and would repeat that check for nothing. A preview RENDER runs on an
     * anonymous public request with no route gate at all, so assuming it ran
     * skips the very check that catches a sharer whose role was withdrawn —
     * the check that makes revocation reach links already in circulation.
     *
     * A default would pick one of those and be wrong for the other in whichever
     * direction nobody notices.
     */
    routeAuthorized: boolean;
  }
): Promise<AuthorizedPreviewCaller> {
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
  // The subject is the REQUESTED id, deliberately — not one derived from the
  // returned document. `read.data` is presentation data: `afterRead` may remove
  // `id` or rewrite it to another row's, so no value in it can be trusted as the
  // identity of what was fetched, and deriving the gate's subject from it
  // authorized a row the bearer will not receive whenever a hook reshaped that
  // field.
  //
  // The token signs the requested id, so that is the id whose editability is
  // asserted here. Where a `beforeOperation` hook maps ids, the bearer's read
  // resolves in ITS OWN context — `user` undefined, `overrideAccess: true` —
  // which this boundary cannot observe. Closing that needs the consumption path
  // to carry the minter's identity rather than a better guess here.
  //
  // `routeAuthorized` skips ONLY the coarse RBAC / code-defined access gate;
  // the stored owner-only, role-based and custom rules still evaluate against
  // the loaded document with the real user either way. Which makes it exactly
  // the flag that must not be decided here: skipping a gate that DID run costs
  // nothing, and skipping one that did not is the difference between enforcing
  // a withdrawn role and ignoring it.
  const mayEdit = await collections.canUpdateEntry({
    collectionName: collection,
    entryId,
    user,
    routeAuthorized: options.routeAuthorized,
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

  /*
   * The grant is PRODUCED by the check, and that is the point of returning one.
   * A caller assembling its own would be asserting the very thing this function
   * exists to establish; minted here it cannot exist unless every refusal above
   * was passed for THIS document.
   */
  return previewCallerAuthorized(user, { collection, entryId });
}

/**
 * Confirm the caller may be handed a preview link for this Single.
 *
 * The Single counterpart of {@link assertEntryPreviewable}, asking the same two
 * questions for the same reason. It is NOT redundant with the route's own gate:
 * that gate is per-slug RBAC, and a Single's stored rules — owner-only, role
 * based, custom — are evaluated against the loaded document and can deny a
 * caller who holds the coarse permission. Stopping at the permission would mint
 * a bearer credential for a draft the real update path refuses to show them.
 *
 * One answer for every refusal, deliberately: a caller who is refused a link
 * learns only that they are refused.
 *
 * @throws {NextlyError} `forbidden` when no link may be minted.
 */
export async function assertSinglePreviewable(
  single: string,
  locale: string | undefined,
  user: UserContext,
  options: {
    /**
     * Whether the CALLER has already passed the coarse RBAC / code-defined
     * access gate for `update` on this Single.
     *
     * Required, and per call site rather than defaulted, for the reason
     * {@link assertEntryPreviewable} states: it is true for the mint, which
     * runs behind `requireRouteCollectionAccess(req, "update", single)`, and
     * false for a preview RENDER, which is an anonymous public request with no
     * route gate at all. Assuming it ran skips the very check that notices a
     * sharer whose role was withdrawn.
     */
    routeAuthorized: boolean;
  }
): Promise<AuthorizedPreviewCaller> {
  const identity = {
    user,
    // No `actor`. It carried an API KEY's own stamped grants, and both mints
    // now refuse a key outright — a preview link records whose permissions the
    // draft renders through, and a key names no person.
    // The TRANSLATION the token will name, so the rules are evaluated against
    // the document the bearer actually receives. A localized Single is a
    // different document per language, and an owner-only or custom rule can
    // answer differently for each — authorizing the default translation and
    // then signing another is authorizing something else.
    ...(locale === undefined ? {} : { locale }),
  };

  if (
    !(await singleDocumentReadable(single, {
      ...identity,
      // FALSE, and this is the whole point. The mint route gated `update`, so
      // nothing has checked this caller's READ permission — and skipping it as
      // redundant would hand a bearer token for the draft to someone holding
      // `update` with no read grant at all.
      routeAuthorized: false,
    }))
  ) {
    throw NextlyError.forbidden({
      logContext: { reason: "preview-link-single-not-visible", single },
    });
  }

  // The token's view is the DRAFT, and the draft overlay surfaces a pending
  // working draft only to a caller trusted to EDIT the document. Reading the
  // published one proves nothing about that.
  if (
    !(await singleDocumentEditable(single, {
      ...identity,
      // TRUE here: the mint route ran exactly this gate, so the coarse update
      // check is the redundant one this flag exists to skip.
      routeAuthorized: options.routeAuthorized,
    }))
  ) {
    throw NextlyError.forbidden({
      logContext: { reason: "preview-link-single-not-editable", single },
    });
  }

  // See {@link assertEntryPreviewable}: the check produces the grant.
  return previewCallerAuthorized(user, { single });
}
