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
    entryId: string,
    locale: string | undefined
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
  deps: PreviewRedirectDeps,
  requestOrigin?: string
): Promise<string | null> {
  const [entry, preview, siteUrl] = await Promise.all([
    // The locale the token names, not the site's default. A localized entry's
    // slug lives in its companion row, so reading without one resolves the
    // DEFAULT language's slug and builds a path to a different translation —
    // while the draft gate goes on comparing the token's locale, so the
    // destination refuses the very draft the link was minted for.
    deps.loadEntry(scope.collection, scope.entryId, scope.locale),
    deps.loadDeclaration(scope.collection),
    deps.loadSiteUrl(),
  ]);

  // A link outlives what it points at: an entry can be deleted between minting
  // and clicking, and that is a refusal rather than a fault.
  if (entry === null) return null;

  return reduceToSitePath({ preview, document: entry, siteUrl, requestOrigin });
}

/**
 * A preview declaration and a document reduced to a site-relative path.
 *
 * Shared by the entry path above and the Single path beside it rather than
 * written twice. Both ask the identical question — given a declaration and the
 * document it describes, what path on this site does it name — and two copies
 * of an origin comparison agree only until one is edited, at which point the
 * one that drifted still returns a plausible-looking path.
 */
export function reduceToSitePath({
  preview,
  document,
  siteUrl,
  requestOrigin,
}: {
  preview: PreviewDeclaration | undefined;
  document: Record<string, unknown>;
  siteUrl: string | null;
  requestOrigin?: string;
}): string | null {
  const resolution = resolvePreviewUrl({ preview, entry: document, siteUrl });

  // `noSiteUrl` is ACCEPTED here, and it is the case that matters most: having
  // no site URL is the default state of a fresh install.
  //
  // That state hides the admin's preview BUTTON for a good reason — the admin
  // may be served from another origin, so it has no host to put in front of a
  // path and the only one within reach is its own, which is confidently wrong.
  // This resolver is not in that position. It answers a route already running
  // ON the site, and returns a site-relative path the browser resolves against
  // the origin it is standing on. Refusing here would make preview depend on a
  // settings field it never reads.
  if (resolution.status === "noSiteUrl") {
    return siteRelativePath(resolution.path);
  }

  if (resolution.status !== "resolved") return null;

  // The origin is COMPARED, never stripped from the URL.
  //
  // A declaration's `url` is application code, free to return any host.
  // Removing the origin would reduce another site's URL to a bare path, and a
  // bare path is precisely what the route's site-relative guard is built to
  // approve — so the guard would run, pass, and have been handed a value that
  // already destroyed the evidence it exists to judge.
  //
  // With no site URL configured, the origin serving this request is the only
  // honest thing to compare against — and it is the right one, because this
  // answers a route running ON the site. Rejecting outright would mean a fresh
  // installation whose declaration returns an absolute same-origin URL still
  // gets a 404.
  const comparisonOrigin = siteUrl ?? requestOrigin;
  if (comparisonOrigin === undefined) return null;
  try {
    const target = new URL(resolution.url);
    const site = new URL(comparisonOrigin);
    if (target.origin !== site.origin) return null;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    // An unparseable site URL or target. Both are configuration a visitor
    // cannot act on, and both refuse the same way everything else here does.
    return null;
  }
}

/**
 * A path that cannot leave this origin, or `null`.
 *
 * Used only where no site URL exists to compare an origin against. A leading
 * slash is not sufficient on its own: `//host` and `/\host` both reach another
 * origin, because a special scheme normalises a backslash to a slash. Both
 * arrive here rather than being caught earlier, since neither parses as an
 * absolute URL either.
 *
 * The parser is asked rather than the list of spellings restated, so this
 * cannot fall behind what a browser accepts. The base is a sentinel that
 * appears in no output: anything still pointing at it after resolution stayed
 * on the current origin, and anything that moved away named a host.
 */
const RESOLUTION_BASE = "https://preview.invalid";

function siteRelativePath(path: string): string | null {
  if (!path.startsWith("/")) return null;
  try {
    const resolved = new URL(path, RESOLUTION_BASE);
    if (resolved.origin !== RESOLUTION_BASE) return null;
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return null;
  }
}

/** What resolving a Single's redirect needs from the outside world. */
export interface SinglePreviewRedirectDeps {
  /**
   * The Single's document in the locale the token names, or `null` if it cannot
   * be read.
   *
   * A Single is addressed by slug, so unlike an entry there is nothing to look
   * up by id — but the document is still needed, because a declaration may
   * derive the path from it.
   */
  loadSingle: (
    slug: string,
    locale: string | undefined
  ) => Promise<Record<string, unknown> | null>;
  /** The Single's preview declaration, from whichever authoring path wrote it. */
  loadDeclaration: (slug: string) => Promise<PreviewDeclaration | undefined>;
  /** The configured site URL, or `null` when none is set. */
  loadSiteUrl: () => Promise<string | null>;
}

/** A Single-scoped token reduced to what a redirect needs. */
export interface SinglePreviewRedirectScope {
  single: string;
  locale?: string;
}

/**
 * The site-relative path a Single's preview token should land on, or `null`.
 *
 * Deliberately its own function rather than a branch inside the entry resolver:
 * the two differ in everything they LOAD — one by id from a collection, one by
 * slug with no id at all — and share only what they do with the result, which
 * is `reduceToSitePath` and is called by both.
 */
export async function resolveSinglePreviewRedirect(
  scope: SinglePreviewRedirectScope,
  deps: SinglePreviewRedirectDeps,
  requestOrigin?: string
): Promise<string | null> {
  const [document, preview, siteUrl] = await Promise.all([
    deps.loadSingle(scope.single, scope.locale),
    deps.loadDeclaration(scope.single),
    deps.loadSiteUrl(),
  ]);

  // A Single is never deleted the way an entry is, but it can be removed from
  // the configuration, and a link minted before that is a link to nothing.
  if (document === null) return null;

  return reduceToSitePath({ preview, document, siteUrl, requestOrigin });
}
