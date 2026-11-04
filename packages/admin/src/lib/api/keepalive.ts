/**
 * Sending a write so it outlives the page.
 *
 * A request sent with `keepalive` is finished by the browser after the page
 * is hidden or closed, which an ordinary one is not. Browsers refuse such a
 * request outright when its body is over 64 KB, so a larger body is sent as an
 * ordinary request instead: one a closing page may cut short, rather than one
 * that never leaves. One rule for every write path that offers it.
 *
 * @module lib/api/keepalive
 */

/** The largest body a request sent with `keepalive` may carry. */
export const KEEPALIVE_BODY_LIMIT: number = 64 * 1024;

/**
 * The request option a write is sent with: `keepalive` when asked for and the
 * body, as it will be sent, fits; nothing otherwise.
 */
export function keepaliveOptions(
  body: unknown,
  keepalive: boolean | undefined
): { keepalive?: true } {
  if (keepalive !== true) return {};
  const sent = body === undefined ? "" : JSON.stringify(body);
  const bytes = new TextEncoder().encode(sent).byteLength;
  return bytes <= KEEPALIVE_BODY_LIMIT ? { keepalive: true } : {};
}
