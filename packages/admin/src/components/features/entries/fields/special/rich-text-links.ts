/**
 * Which URLs the rich-text editor turns into links by itself, and which a
 * link may point at.
 *
 * Typing or pasting a web address or an email address makes it a link
 * (`AutoLinkPlugin`, with the matchers below), and pasting an address over
 * selected text links that text (`LinkPlugin`'s `validateUrl`). Each is
 * judged first, so prose that only looks like an address stays text.
 *
 * @module components/entries/fields/special/rich-text-links
 */
import {
  autoLinkEmailMatcher,
  autoLinkUrlMatcher,
  type LinkMatcher,
} from "@lexical/link";

/** The schemes an address typed into the text becomes a link for. */
const AUTO_LINK_PROTOCOLS: ReadonlySet<string> = new Set([
  "http:",
  "https:",
  "mailto:",
]);

/**
 * Schemes a link never points at: each runs or embeds content in the page
 * rather than taking the reader somewhere.
 */
const UNSAFE_LINK_PROTOCOLS: ReadonlySet<string> = new Set([
  "javascript:",
  "data:",
  "vbscript:",
]);

/** `url` parsed as an absolute URL, or null where it is not one. */
function parsed(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * Whether `url`, found in typed or pasted text, becomes a link: an http or
 * https address with a host, or a mailto address naming a mailbox.
 */
function isAutoLinkUrl(url: string): boolean {
  const found = parsed(url);
  if (found === null || !AUTO_LINK_PROTOCOLS.has(found.protocol)) return false;
  return found.protocol === "mailto:"
    ? found.pathname.includes("@")
    : found.hostname !== "";
}

/**
 * Whether a link may point at `url`: an absolute URL whose scheme takes the
 * reader somewhere. The link dialog's own addresses (web, mailto, tel) all
 * pass; a script or inline-data URL does not.
 */
export function isLinkUrl(url: string): boolean {
  const found = parsed(url);
  return found !== null && !UNSAFE_LINK_PROTOCOLS.has(found.protocol);
}

/** `matcher`, answering only for an address {@link isAutoLinkUrl} accepts. */
function judged(matcher: LinkMatcher): LinkMatcher {
  return text => {
    const found = matcher(text);
    return found !== null && isAutoLinkUrl(found.url) ? found : null;
  };
}

/**
 * What `AutoLinkPlugin` links as it is typed or pasted: web addresses
 * (`https://…`, `http://…`, and `www.…` as https) and email addresses (as
 * mailto), with Lexical's own matchers, each judged before it is linked.
 */
export const AUTO_LINK_MATCHERS: readonly LinkMatcher[] = [
  judged(autoLinkUrlMatcher),
  judged(autoLinkEmailMatcher),
];
