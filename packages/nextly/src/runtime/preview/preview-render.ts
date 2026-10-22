/**
 * A preview render: the one path that honours a preview link.
 *
 * A link is not a caller anywhere. REST, the admin, the Direct API and plugin
 * routes and services judge a request that carries one as whoever sent it, and
 * read no preview cookie. Only the render of a draft through a content or
 * Single route opens the link, and it opens it here: once the link is verified,
 * reaches the document the route is about to read, and names a sharer who is
 * still an active account.
 *
 * What it yields is not an identity to act as. It names the link's document,
 * the language the link is to, and the person who shared it, so each draft gate
 * can ask the ordinary access checks about that person, in that language, at
 * every open. The person holding the link gains nothing from it.
 *
 * @module runtime/preview/preview-render
 */
import {
  isSingleScope,
  previewTokenCovers,
  type PreviewTokenScope,
} from "../../auth/preview/preview-token";
import type { UserContext } from "../../domains/collections/services/collection-types";

import { resolvePreviewIdentity } from "./preview-identity";
import {
  readPreviewSession,
  type PreviewScopeReaderConfig,
} from "./preview-route";

/** An opened preview link, for the render of the document it names. */
export interface PreviewRender {
  /** The link's document, as it was signed. */
  readonly scope: PreviewTokenScope;
  /**
   * The language the link is to, or undefined for a link naming none, which
   * is to the document in every language.
   */
  readonly locale: string | undefined;
  /** The person who shared the link, as the access checks ask about them. */
  readonly sharer: UserContext;
}

/**
 * The document a route is about to render a draft of. An entry is named by
 * its collection alone, because the route has not resolved a row yet: the
 * entry the link names is compared against the row it resolves, later.
 */
export type RenderedDocument =
  | { kind: "single"; single: string; locale?: string | undefined }
  | { kind: "entry"; collection: string; locale?: string | undefined };

/**
 * Open the request's preview link for `document`, or null when it may not be
 * opened there: no link, one that no longer verifies, one to another document
 * or language, or one whose sharer cannot be named.
 *
 * Read per request. Whether this visitor is previewing, and whether their link
 * has since expired or been revoked, is a fact about the request in hand.
 */
export async function openPreviewRender(
  config: PreviewScopeReaderConfig,
  document: RenderedDocument
): Promise<PreviewRender | null> {
  const verified = await readPreviewSession(config);
  if (verified === null) return null;
  const { scope, minter } = verified;

  const requested = requestedFrom(scope, document);
  if (requested === null || !previewTokenCovers(scope, requested)) {
    return null;
  }

  // **No identity, no draft.** A link minted before the sharer was recorded,
  // and a sharer whose account has been deleted or deactivated, both arrive
  // here without one. A draft is read trusted, and its fields are judged as
  // the sharer; with no sharer it would be read with no field rules at all.
  // So it is refused, and the request resolves published-only,
  // indistinguishable from an expired link.
  if (minter === undefined) return null;
  const sharer = await resolvePreviewIdentity(minter);
  if (sharer === null) return null;

  return { scope, locale: scope.locale, sharer };
}

/**
 * The scope the route's request amounts to, compared against the link's.
 *
 * The locale comes from the ROUTE, so it is the language about to be read: a
 * link to `en` must not open the `fr` document. An entry takes the link's own
 * id, since the route compares it against the row it resolves; a link to a
 * Single cannot open a collection entry, so it gives none.
 */
function requestedFrom(
  scope: PreviewTokenScope,
  document: RenderedDocument
): PreviewTokenScope | null {
  const locale =
    document.locale === undefined ? {} : { locale: document.locale };
  if (document.kind === "single") {
    return { kind: "single", single: document.single, ...locale };
  }
  if (isSingleScope(scope)) return null;
  return { collection: document.collection, entryId: scope.entryId, ...locale };
}
