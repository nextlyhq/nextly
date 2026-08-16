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
import { previewTokenCovers } from "../../auth/preview/preview-token";
import type { PreviewTokenScope } from "../../auth/preview/preview-token";

import { readPreviewScope } from "./preview-route";
import type { PreviewScopeReaderConfig } from "./preview-route";

/**
 * What a content route hands its `draft` hook for the path being resolved.
 *
 * Declared structurally rather than imported from `runtime/routing`, so this
 * module stays inside `runtime/preview` and the two do not become mutually
 * dependent for one parameter shape.
 */
export interface DraftGateRequest {
  collection: string;
  slug: string;
}

/** Options for {@link previewDraftGate}. */
export interface PreviewDraftGateConfig extends PreviewScopeReaderConfig {
  /**
   * The locale this route reads in, when the site is localized.
   *
   * A token may be scoped to one locale, and that is the third thing
   * {@link previewTokenCovers} compares. The hook is told the collection and the
   * slug, never the locale, so a gate that could not be given it would have to
   * skip that comparison — silently widening a token minted for one translation
   * to every translation of the same entry.
   *
   * Omit it only for a site with no locales. A token carrying no locale covers
   * every locale by design, so omitting this is correct there and nothing is
   * skipped.
   */
  locale?: string;
}

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
  config: PreviewDraftGateConfig
): (request: DraftGateRequest) => Promise<{ entryId: string } | false> {
  return async ({ collection }) => {
    // Re-read per request. The config is captured once at module scope while
    // whether this visitor is previewing — and whether their token has since
    // expired or been revoked — is a fact about the request in hand.
    const scope = await readPreviewScope(config);
    if (scope === null) return false;

    // Asked of the shared rule rather than compared field by field here. The
    // rule already decides collection, entry and locale together, and a second
    // comparison in this file would be the drift that turns "a preview session
    // exists" into "this preview session covers what is being read".
    //
    // `entryId` is the scope's own, because the route has not resolved a
    // document yet and this gate must not perform a read of its own to guess
    // one. That leaves the entry comparison to the route, which makes it
    // against the row it actually resolved — a stronger check than any this
    // function could do from a slug.
    const requested: PreviewTokenScope = {
      collection,
      entryId: scope.entryId,
      ...(config.locale === undefined ? {} : { locale: config.locale }),
    };
    if (!previewTokenCovers(scope, requested)) return false;

    return { entryId: scope.entryId };
  };
}
