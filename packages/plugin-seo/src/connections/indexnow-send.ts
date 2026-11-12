/**
 * The one request IndexNow is told through: the changed addresses of one
 * host, with the site's key, to IndexNow's shared endpoint, which passes them
 * on to every search engine taking part. Its own module so the request is
 * made in one place, and so a test can stand in for the endpoint.
 *
 * @module connections/indexnow-send
 */

/** IndexNow's shared endpoint, the only address this module reaches. */
export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

/** Its host, for the plugin's outbound allowlist. */
export const INDEXNOW_HOST = "api.indexnow.org";

/** How long the endpoint is given to answer. */
const TIMEOUT_MS = 10_000;

/** A fetch the plugin may use: core's `ctx.fetch`, held to its allowlist. */
export type OutboundFetch = (
  url: string,
  init: RequestInit
) => Promise<Response>;

/** One notice: a host's changed addresses, and the key that proves the host. */
export interface IndexNowNotice {
  host: string;
  key: string;
  urlList: string[];
}

/**
 * Send `notice`, answering the status the endpoint answered with. A redirect
 * is refused rather than followed, so nothing goes anywhere but the endpoint;
 * throws when it could not be reached in time.
 */
export async function sendIndexNow(
  fetch: OutboundFetch,
  notice: IndexNowNotice
): Promise<number> {
  const response = await fetch(INDEXNOW_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(notice),
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // Only the status says how it went; the body is not read.
  await response.body?.cancel();
  return response.status;
}
