/**
 * Where a written email may point: one check for a fixed address in the
 * stored blocks and for an address a send supplies (`safe_url`).
 *
 * A complete http or https address, with a host, and for a link a mailto
 * address with a recipient as well. Anything else points nowhere a reader
 * can follow (`https://`, `https:///path`, `mailto:`) or somewhere a reader
 * must not be sent (`javascript:`, `data:`).
 *
 * @module domains/email/written/urls
 */

/** The scheme, then a host straight after the slashes. */
const WEB = /^https?:\/\/[^\s/?#]/i;
/** The scheme, then a recipient. */
const MAIL = /^mailto:[^\s?]/i;

/** What an address is for: a link may also open a mail client. */
export type UrlKind = "link" | "image";

/** Whether `value` is an address a written email may point to. */
export function allowedUrl(value: string, kind: UrlKind): boolean {
  const url = value.trim();
  if (WEB.test(url)) return parses(url);
  return kind === "link" && MAIL.test(url) && parses(url);
}

function parses(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}
