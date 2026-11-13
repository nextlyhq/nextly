/**
 * Next.js's control-flow errors, as Next.js recognises them: by their digest.
 *
 * `notFound()` and `permanentRedirect()` throw an error whose `digest` names
 * what to answer, and Next.js's renderer tells them from a failure by that
 * digest alone (`isHTTPAccessFallbackError`, `isRedirectError`). Built here so
 * a not-found or a redirect still reaches Next.js when `next/navigation`
 * cannot be loaded: a deployment whose trace left out a module it requires.
 * The formats are next 16.4's (`client/components/not-found.js`,
 * `client/components/redirect.js`), and a test holds them to the installed
 * Next.js's own checks, so a release that changes one fails there.
 *
 * These are Next.js's errors, not Nextly's: a `NextlyError` would be a 500,
 * which is the failure this exists to avoid.
 *
 * @module runtime/next-control-flow
 */

/** The first segment of every redirect's digest. */
export const NEXT_REDIRECT_CODE = "NEXT_REDIRECT";

/** The first segment of a not-found, forbidden or unauthorized digest. */
export const NEXT_HTTP_ERROR_FALLBACK_CODE = "NEXT_HTTP_ERROR_FALLBACK";

/** Next.js's status for a permanent redirect (`RedirectStatusCode`). */
const PERMANENT_REDIRECT_STATUS = 308;

/** An error carrying `digest`, as Next.js's own helpers build one. */
function withDigest(
  message: string,
  digest: string
): Error & { digest: string } {
  return Object.assign(new Error(message), { digest });
}

/** What `notFound()` throws: Next.js answers 404 with the not-found boundary. */
export function notFoundError(): Error & { digest: string } {
  const digest = `${NEXT_HTTP_ERROR_FALLBACK_CODE};404`;
  return withDigest(digest, digest);
}

/**
 * What `permanentRedirect(url)` throws: Next.js answers 308 to `url`,
 * replacing the history entry, as its own default does.
 */
export function permanentRedirectError(
  url: string
): Error & { digest: string } {
  return withDigest(
    NEXT_REDIRECT_CODE,
    `${NEXT_REDIRECT_CODE};replace;${url};${PERMANENT_REDIRECT_STATUS};`
  );
}
