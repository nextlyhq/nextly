/**
 * `previewSingleDraftGate` — wire a preview token to a Single route's `draft`
 * hook.
 *
 * A sibling of `previewDraftGate` rather than a branch inside it, because the
 * two answer different questions and return different things. A collection gate
 * hands back an entry id, so the route can compare the grant against the row a
 * PATH resolved to; a Single has no path to resolve and no id — its slug is its
 * identity — so the gate settles the whole question and answers a boolean.
 *
 * Sharing one function would mean a return type that is sometimes an id and
 * sometimes a boolean, and a caller that has to know which. Two functions with
 * one comparison underneath is the honest arrangement: `previewTokenCovers`
 * remains the single place a scope is judged.
 *
 * @module runtime/preview/preview-single-draft-gate
 */
import { previewTokenCovers } from "../../auth/preview/preview-token";
import type { UserContext } from "../../direct-api/types/shared";
import {
  singleDocumentEditable,
  singleStoredDocumentReadable,
} from "../../domains/singles/services/single-document-access";
import type { SingleDraftRequest } from "../routing/single-route";

import { resolvePreviewIdentity } from "./preview-identity";
import { readPreviewSession } from "./preview-route";
import type { PreviewScopeReaderConfig } from "./preview-route";

/** Options for {@link previewSingleDraftGate}. */
export type PreviewSingleDraftGateConfig = PreviewScopeReaderConfig;

/**
 * A `draft` hook that grants exactly the Single the request's token covers.
 *
 * Callable with no argument, like its collection counterpart: the signing
 * secret, the revocation generation and the request's cookies are facts about
 * the booted instance and the request in hand, not decisions a site makes.
 */
export function previewSingleDraftGate(
  config: PreviewSingleDraftGateConfig = {}
): (request: SingleDraftRequest) => Promise<{ readAs: UserContext } | false> {
  return async ({ slug, locale }) => {
    // Re-read per request. The configuration is captured once, while whether
    // this visitor is previewing — and whether their token has since expired or
    // been revoked — is a fact about the request in hand.
    const verified = await readPreviewSession(config);
    if (verified === null) return false;
    const { scope, minter } = verified;

    // A collection entry's token cannot open a Single — a Single named `pages`
    // is not the `pages` collection — and that comparison is NOT repeated here.
    // `previewTokenCovers` compares the kind first, so a guard beside it would
    // be a second copy of a question it already owns, and the copy is the one
    // that keeps the old policy when the shared rule moves.
    //
    // Asked of the shared comparison rather than rebuilt from its parts. The
    // locale comes from the ROUTE, so it is the language about to be read: a
    // token scoped to `en` must not grant the `fr` document, and taking the
    // locale from this gate's own configuration would make it a second
    // declaration of a value the route already holds.
    if (
      !previewTokenCovers(scope, {
        kind: "single",
        single: slug,
        ...(locale === undefined ? {} : { locale }),
      })
    ) {
      return false;
    }

    // The document is read TRUSTED so the working draft appears at all, and
    // trust switched field-level read rules off with it. So the fields are
    // judged separately, as the person who shared the link — otherwise the
    // recipient sees fields the sharer cannot, which turns the link into a way
    // to read past your own permissions by sending yourself one.
    //
    // **No identity, no draft.** A token minted before the claim existed, and a
    // sharer whose account has been deleted or deactivated, both arrive here
    // without one. Granting anyway would read the document with no field rules
    // at all, which IS the defect — so the grant is refused and the request
    // resolves published-only, indistinguishable from an expired link.
    if (minter === undefined) return false;
    const readAs = await resolvePreviewIdentity(minter);
    if (readAs === null) return false;

    // Asked again, on every render, and that is what makes revocation real.
    // Rebuilding the sharer's identity re-evaluates FIELD rules and nothing
    // else: the read below runs with `overrideAccess: true`, so the Single's
    // own document rules are bypassed. A sharer who loses their update role, or
    // stops satisfying a custom rule, would otherwise keep serving the draft to
    // whoever holds the link until it expired — an account that is still
    // ACTIVE, so the deactivation check does not reach it either.
    //
    // **Both halves the mint asks, through probes that do not read.** The
    // mint asks them through `assertSinglePreviewable`, whose readable half
    // goes through `SingleQueryService.get`: that AUTO-CREATES a missing
    // Single — row, localized defaults and a first version — and runs the
    // Single's read hooks. A render is an anonymous public request, so asking
    // that way would let whoever holds a link persist a document and fire hook
    // side effects, attributed to the sharer, on a page view. Reads do not
    // write. So both are asked of the STORED row through the adapter, and the
    // Single's access gate is run against it for each operation.
    //
    // Editable, because the working-draft overlay is gated on being able to
    // EDIT the document, so edit capability decides whether a draft may be
    // handed out at all. Readable as well, because the draft is a view of the
    // document: a sharer who keeps update access and loses read access through
    // a custom rule is no longer allowed to see what the link shows.
    //
    // The sharer is asked about, never acted as: this decides whether the
    // link may serve the draft and as whom its fields are judged, and the
    // person holding the link gains nothing from it.
    const sharer = {
      user: readAs,
      // FALSE: a render is an anonymous public request. Nothing ran the
      // coarse access gate for it, and claiming otherwise skips the only part
      // that notices a withdrawn role.
      routeAuthorized: false,
    };
    if (
      !(await singleDocumentEditable(slug, sharer)) ||
      !(await singleStoredDocumentReadable(slug, sharer))
    ) {
      return false;
    }

    return { readAs };
  };
}
