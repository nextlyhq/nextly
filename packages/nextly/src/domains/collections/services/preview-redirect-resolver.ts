/**
 * Where a preview token sends the visitor.
 *
 * The preview route is handed a token scope — a collection, an entry id and
 * maybe a locale — and needs a site-relative path to forward to. Everything
 * required to answer that already exists: `resolvePreviewUrl` knows how both
 * authoring paths declare a preview, and the general settings hold the site
 * URL. What did not exist was anything joining them FROM AN ID, because the
 * admin's own preview button resolves from form data instead — it previews what
 * is on screen, including edits not yet saved, while a token names a stored
 * document and carries no values at all.
 *
 * Dependencies arrive as functions rather than being resolved here, so this
 * file is exercisable without a database — the same arrangement
 * `createPreviewRoute` uses for `draftMode`.
 *
 * @module domains/collections/services/preview-redirect-resolver
 */

import {
  resolvePreviewUrl,
  type PreviewDeclaration,
} from "./preview-url-resolver";

/** What this resolver needs from the outside world. */
export interface PreviewRedirectDeps {
  /**
   * The entry the token names, or `null` if it is gone.
   *
   * Read TRUSTED and with the lifecycle widened, because the caller is
   * anonymous: someone following a preview link has no session of their own.
   * The authorization happened when the link was minted, against the gate that
   * serves real reads, and the signed token is what carries that verdict
   * forward. Asking again here — against an anonymous caller — would deny every
   * preview, which is the whole capability.
   *
   * What this read produces is a PATH and never content. The content read is a
   * separate decision, made on the destination page by the draft gate, against
   * the row that page actually resolves.
   */
  loadEntry: (
    collection: string,
    entryId: string
  ) => Promise<Record<string, unknown> | null>;
  /** The collection's preview declaration, from whichever authoring path wrote it. */
  loadDeclaration: (
    collection: string
  ) => Promise<PreviewDeclaration | undefined>;
  /** The configured site URL, or `null` when none is set. */
  loadSiteUrl: () => Promise<string | null>;
}

/** A token scope reduced to what a redirect needs. */
export interface PreviewRedirectScope {
  collection: string;
  entryId: string;
  locale?: string;
}

/**
 * The site-relative path a preview token should land on, or `null` to refuse.
 *
 * `null` is not an error channel. The preview route answers it with exactly the
 * 404 an invalid token gets, which is what keeps the endpoint from becoming an
 * oracle for which entries exist in draft: a stranger must not be able to tell
 * a deleted entry from one that was never previewable from one whose token was
 * forged.
 */
export async function resolvePreviewRedirect(
  scope: PreviewRedirectScope,
  deps: PreviewRedirectDeps
): Promise<string | null> {
  const [entry, preview, siteUrl] = await Promise.all([
    deps.loadEntry(scope.collection, scope.entryId),
    deps.loadDeclaration(scope.collection),
    deps.loadSiteUrl(),
  ]);

  // A link outlives what it points at: an entry can be deleted between minting
  // and clicking, and that is a refusal rather than a fault.
  if (entry === null) return null;
  if (siteUrl === null) return null;

  const resolution = resolvePreviewUrl({ preview, entry, siteUrl });
  if (resolution.status !== "resolved") return null;

  // The origin is COMPARED against the site's, never stripped from the URL.
  //
  // A collection's `preview.url` is application code, free to return any host.
  // Removing the origin would reduce another site's URL to a bare path, and a
  // bare path is precisely what the route's site-relative guard is built to
  // approve — so the guard would run, pass, and have been handed a value that
  // already destroyed the evidence it exists to judge. Comparing first means
  // the only URL that survives is one already on the site's own origin.
  try {
    const target = new URL(resolution.url);
    const site = new URL(siteUrl);
    if (target.origin !== site.origin) return null;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    // An unparseable site URL or target. Both are configuration a visitor
    // cannot act on, and both refuse the same way everything else here does.
    return null;
  }
}
