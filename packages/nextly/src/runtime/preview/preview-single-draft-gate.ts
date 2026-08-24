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
import type { SingleDraftRequest } from "../routing/single-route";

import { readPreviewScope } from "./preview-route";
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
): (request: SingleDraftRequest) => Promise<boolean> {
  return async ({ slug, locale }) => {
    // Re-read per request. The configuration is captured once, while whether
    // this visitor is previewing — and whether their token has since expired or
    // been revoked — is a fact about the request in hand.
    const scope = await readPreviewScope(config);
    if (scope === null) return false;

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
    return previewTokenCovers(scope, {
      kind: "single",
      single: slug,
      ...(locale === undefined ? {} : { locale }),
    });
  };
}
