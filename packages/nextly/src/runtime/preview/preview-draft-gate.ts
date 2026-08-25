/**
 * `previewDraftGate` — wire a preview token to a content route's `draft` hook.
 *
 * The pieces to do this already existed: `readPreviewScope` re-verifies the
 * token, `previewTokenCovers` decides whether a scope reaches a document, and
 * `ContentRouteConfig.draft` is asked per path. What did not exist was anything
 * JOINING them, so every site had to write the join itself from a doc comment.
 *
 * **That is why this is a function rather than an example.** The join is short
 * and it is security-critical, and its failure is silent in the expensive
 * direction: Next's draft mode is one boolean for the whole host, so answering
 * from `draftMode().isEnabled` alone turns a link scoped to ONE unpublished
 * entry into a key to every unpublished entry in the configured collections,
 * for the life of the session. Nothing errors, nothing logs, and the page looks
 * right to whoever opened it. A recipe each caller retypes is not a boundary.
 *
 * @module runtime/preview/preview-draft-gate
 */
import { assertEntryPreviewable } from "../../api/preview-access";
import {
  isSingleScope,
  type PreviewTokenScope,
} from "../../auth/preview/preview-token";
import type { UserContext } from "../../domains/collections/services/collection-types";
import type { ResolvedContext } from "../routing/content-route";

import { resolvePreviewIdentity } from "./preview-identity";
import { previewGrantsDraft, readPreviewSession } from "./preview-route";
import type { PreviewScopeReaderConfig } from "./preview-route";

/**
 * What a content route hands its `draft` hook for the path being resolved.
 *
 * DERIVED from the route's own context rather than restated, and the `locale`
 * member is why. Restating it compiles for as long as the two spellings agree,
 * and the day the route renames or drops that member this gate reads
 * `undefined` and stops comparing locale at all — granting a token minted for
 * one translation against every other. Naming the members here makes that a
 * compile error. The import is type-only, so nothing links `runtime/preview` to
 * `runtime/routing` at runtime.
 */
export type DraftGateRequest = Pick<
  ResolvedContext,
  "collection" | "slug" | "locale"
>;

/** Options for {@link previewDraftGate}. */
export type PreviewDraftGateConfig = PreviewScopeReaderConfig;

/**
 * A `draft` hook that grants exactly what the request's preview token covers.
 *
 * Returns `{ entryId }` rather than `true`, and that is the load-bearing half.
 * A slug is not unique across collections or over time, so `true` grants
 * whichever row the route happens to resolve the path to — which need not be
 * the entry the token was minted for. Naming the entry lets the route check the
 * grant against the document it actually resolved, so the identity comparison
 * happens against the resolved row rather than against a path.
 *
 * ```ts
 * createBlocksPage({
 *   collections: ["pages"],
 *   field: "content",
 *   draft: previewDraftGate({ secret, generation, cookies }),
 * });
 * ```
 *
 * **Callable with no argument, which is how it should normally be written.**
 * The three values it needs — the signing secret, the revocation generation and
 * the request's cookies — are facts about the booted instance and the request
 * in hand rather than decisions a site makes. Requiring them turned a one-line
 * gate into a paragraph of wiring, and a gate nobody writes is worse than an
 * absent one: the preview link mints, redirects, and then answers 404 from a
 * page that looks entirely correct.
 *
 * **The route's own `status` is deliberately left alone.** It widens internally
 * for the request a grant applies to, so configuring `status: "all"` adds
 * nothing and takes something away: the widened scope then also covers the
 * resolver's id/slug mismatch path, where a visitor holding a token for entry A
 * asking for a DIFFERENT unpublished slug in the same collection can be answered
 * with that unrelated entry. Per-entry scope is the whole point of the token, so
 * a configuration that defeats it must not be taught alongside the thing that
 * enforces it.
 */
export function previewDraftGate(
  config: PreviewDraftGateConfig = {}
): (
  request: DraftGateRequest
) => Promise<{ entryId: string; readAs: UserContext } | false> {
  return async ({ collection, locale }) => {
    // Re-read per request. The config is captured once at module scope while
    // whether this visitor is previewing — and whether their token has since
    // expired or been revoked — is a fact about the request in hand.
    const verified = await readPreviewSession(config);

    if (verified === null) return false;
    const { scope, minter } = verified;

    // A Single's token cannot grant a collection draft. Both name one document
    // and only one, but they are different documents — and this gate answers
    // for a COLLECTION path, so a single-scoped token reaching it is a token
    // for somewhere else entirely.
    if (isSingleScope(scope)) return false;

    // `previewGrantsDraft` owns the whole authorization question — an absent
    // session AND whether a present one reaches the document — so it is asked
    // rather than rebuilt from its parts. Rejecting null here and calling
    // `previewTokenCovers` beside it is the same decision computed twice, and
    // the copy is the one that keeps the old policy when the shared one moves.
    //
    // `entryId` is the scope's own, because the route has not resolved a
    // document yet and this gate must not read one of its own to guess. That
    // leaves the entry comparison to the route, made against the row it
    // actually resolved — a stronger check than any this function could do
    // from a slug.
    // The locale comes from the REQUEST, so it is the one the route is about to
    // read in. Taking it from this gate's own config made it a second
    // declaration of a value the route already holds, and the two disagreeing
    // is not a type error: a token scoped to `en` satisfies an `en` gate, and
    // the entry it names is then resolved in the route's `fr`.
    const requested: PreviewTokenScope = {
      collection,
      entryId: scope.entryId,
      ...(locale === undefined ? {} : { locale }),
    };
    if (!previewGrantsDraft(scope, requested)) return false;

    // The row is read trusted so the working draft appears at all, and trust
    // switched field-level read rules off with it. So the fields are judged
    // separately, as the person who shared the link — otherwise the recipient
    // sees fields the sharer cannot, which turns the link into a way to read
    // past your own permissions by sending yourself one.
    //
    // **No identity, no draft.** Two cases reach this line without one: a token
    // minted before the claim existed, and a sharer whose account has since
    // been deleted. Granting the draft anyway would read it with no field rules
    // at all, which IS the defect — so the grant is refused and the request
    // resolves published-only, indistinguishable from an expired link. That
    // does invalidate preview links minted in the hour before this ships;
    // keeping a known field leak open for the lifetime of a token is the worse
    // trade, and nothing new is mintable without a minter.
    if (minter === undefined) return false;
    const readAs = await resolvePreviewIdentity(minter);
    if (readAs === null) return false;

    // Asked again, on every render, and that is what makes revocation real.
    //
    // Rebuilding the sharer's identity re-evaluates FIELD rules against their
    // current permissions and nothing else: the read below runs with
    // `overrideAccess: true`, so the collection gate and every row-level rule
    // are bypassed. A sharer who loses their update role, or stops satisfying
    // an owner-only rule, would therefore keep serving the draft to whoever
    // holds the link until it expired — an account that is still ACTIVE, so the
    // deactivation check does not reach it either.
    //
    // The SAME function the mint uses, rather than a second implementation of
    // "may this person preview this entry". Two versions of that question agree
    // on the day they are written; the one that drifts is the one nobody runs,
    // and here they would drift into a link that mints and cannot render, or
    // renders and should not.
    try {
      await assertEntryPreviewable(collection, scope.entryId, readAs, {
        // FALSE, and this is the load-bearing half. A render is an anonymous
        // public request: nothing ran the coarse RBAC / code-defined access
        // gate for it, so claiming otherwise would skip the check that notices
        // a sharer's role was withdrawn — leaving this "re-authorization" able
        // to catch only a deleted or deactivated account.
        routeAuthorized: false,
      });
    } catch {
      // Refused rather than propagated. A revoked link is an ordinary request
      // outcome — the visitor sees the published page or a 404, the same as an
      // expired one — not a 500 on a page that was working yesterday.
      return false;
    }

    return { entryId: scope.entryId, readAs };
  };
}
