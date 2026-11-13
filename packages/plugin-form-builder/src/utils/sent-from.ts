/**
 * The page a submission was sent from, as the submission keeps it: the web
 * address the visitor's browser reported in `Referer`, reduced to its origin
 * and path. Its query and fragment are dropped, since a page's address can
 * carry personal data there (a search, an email in a link, a token), and an
 * address that is not a web page (another scheme, or none) is not kept. The
 * browser reports it, so it is a hint for staff, not evidence.
 *
 * @module utils/sent-from
 */

/** The longest address kept, in characters; a longer one is not kept. */
const PAGE_MAX = 2048;

/** The page a `Referer` names, or undefined when it names no web page. */
export function pageFromReferer(
  referer: string | null | undefined
): string | undefined {
  if (!referer) return undefined;
  let url: URL;
  try {
    url = new URL(referer);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  const page = `${url.origin}${url.pathname}`;
  return page.length <= PAGE_MAX ? page : undefined;
}
