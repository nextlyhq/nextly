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
import { assertSinglePreviewable } from "../../api/preview-access";
import { previewTokenCovers } from "../../auth/preview/preview-token";
import type { UserContext } from "../../direct-api/types/shared";
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
    // The SAME function the mint uses, rather than a second implementation of
    // "may this person preview this Single". `routeAuthorized: false` because a
    // render is an anonymous public request: nothing ran the coarse access gate
    // for it, and claiming otherwise skips the only part that notices a
    // withdrawn role.
    try {
      await assertSinglePreviewable(slug, locale, readAs, {
        routeAuthorized: false,
      });
    } catch {
      // Refused rather than propagated. A revoked link is an ordinary request
      // outcome — the visitor sees the published document or a 404, the same as
      // an expired one — not a 500 on a page that was working yesterday.
      return false;
    }

    return { readAs };
  };
}
