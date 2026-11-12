/**
 * Which requested addresses are pages: the rule the site's Proxy reads a
 * request by before it looks for a redirect or passes the address on to the
 * not-found log, and so the rule a redirect's From address is held to.
 *
 * @module not-found/page-address
 */

/** The longest address the log keeps; a longer one is not a page anyone links to. */
const LONGEST_ADDRESS = 2048;

/** The first path segments no public page is ever served under. */
const LEFT_OUT_PREFIXES = ["/admin", "/api", "/_next"];

/** Files a browser fetches for a page rather than pages: scripts, styles, images, fonts, media. */
const ASSET_EXTENSION =
  /\.(?:js|mjs|cjs|css|map|png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?|woff2?|ttf|otf|eot|mp4|webm|ogg|mp3|wav|flac|m4a|mov)$/i;

/**
 * Whether a request for `path` stays out of the log: the admin, the API,
 * Next.js's own files, a static asset, or an address too long to be a page.
 */
export function notAPageAddress(path: string): boolean {
  if (path.length > LONGEST_ADDRESS) return true;
  if (
    LEFT_OUT_PREFIXES.some(
      prefix => path === prefix || path.startsWith(`${prefix}/`)
    )
  ) {
    return true;
  }
  return ASSET_EXTENSION.test(path);
}
