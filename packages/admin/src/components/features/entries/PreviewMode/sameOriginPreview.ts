/**
 * Whether a minted preview URL can be rendered in a frame at all.
 *
 * The site's draft route needs the `__nextly_preview` cookie, and the preview
 * route both SETS that cookie and then redirects — so a frame pointed at
 * another site has to store a third-party cookie and send it back. Browsers
 * refuse in both directions, and they refuse SILENTLY: the frame loads, the
 * draft gate finds no session, and the reader is served the published page or a
 * 404. A preview that shows published content while looking like a preview is
 * worse than no pane at all, so the pane declines rather than lying.
 *
 * Same ORIGIN rather than same site, deliberately. Same-site is the property
 * the cookie is actually keyed on, but deciding it needs the public suffix
 * list — `example.com` and `example.co.uk` differ by a rule no browser API
 * exposes to a page. Origin equality is scheme, host and port, it needs no
 * table, and it is a strict SUBSET of same-site: every URL this accepts would
 * have worked, and the ones it wrongly refuses (`admin.example.com` against
 * `example.com`) lose the pane rather than gaining a broken one. That is the
 * safe direction to be wrong in, and it is the only direction available without
 * asking the site itself.
 *
 * Asking the site is the better answer and it is a different change: the
 * previewed page reporting back that it holds a preview session would observe
 * the outcome instead of predicting it, and would recover every deployment this
 * refuses. Until then this is a prediction, and it is built to err toward the
 * tab.
 *
 * The default deployment is unaffected. `templates/base` mounts the admin at
 * `/admin` inside the same Next.js app that serves the site, and
 * `resolvePreviewSiteUrl` falls back to `NEXT_PUBLIC_APP_URL` — the origin the
 * admin is already being served from.
 *
 * @module components/features/entries/PreviewMode/sameOriginPreview
 */

/**
 * @param href - the minted preview URL
 * @param adminOrigin - the origin the admin is served from
 * @returns true when a frame at `adminOrigin` can carry the preview cookie
 */
export function isSameOriginPreview(
  href: string,
  adminOrigin: string
): boolean {
  let previewOrigin: string;
  try {
    previewOrigin = new URL(href).origin;
  } catch {
    // Unparseable is not framable. The mint is expected to return an absolute
    // http(s) URL, so reaching this means something upstream changed shape —
    // and guessing "probably fine" there is how the silent failure gets in.
    return false;
  }
  // `origin` is opaque for schemes that have none — `blob:`, `data:`, `file:`
  // all serialise as the string "null", and two of them comparing equal must
  // not read as same-origin.
  if (previewOrigin === "null" || adminOrigin === "null") return false;
  return previewOrigin === adminOrigin;
}

/**
 * The origin this admin is served from, or null where there is no document.
 *
 * Returns null under SSR rather than a guess. Nothing calls the predicate on
 * the server today — minting happens in an effect — but a null that a caller
 * must handle is a better shape than an empty string that quietly fails every
 * comparison and reports every deployment as cross-origin.
 */
export function currentAdminOrigin(): string | null {
  if (typeof window === "undefined") return null;
  return window.location.origin;
}
