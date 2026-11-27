/**
 * The rendered page a plain-text copy is made from, where the page has no
 * stored words to make one from: a page built in the site's code, or one
 * whose content is a layout (a Page Builder page). The page is asked for as
 * a visitor with no session asks for it, at its own listed address, so
 * nothing the public may not read is ever in it.
 *
 * Kept for a few minutes per page, for the plugin's context the copy is
 * asked in (one per running site), so an agent reading a site page by page
 * does not render each page again.
 *
 * @module outputs/rendered-fetch
 */
import { renderedCopyOf, type RenderedCopy } from "./rendered-copy";

/** How long a rendered copy is kept: as long as a copy's answer may be cached. */
const KEPT_MS = 5 * 60 * 1000;

/** How many rendered copies are kept at once, the oldest let go first. */
const KEPT_MAX = 200;

/** How long a page may take to render before the copy is given up. */
const RENDER_TIMEOUT_MS = 10_000;

/** The most HTML read of one page: a page past it is not copied. */
const MAX_HTML_BYTES = 6 * 1024 * 1024;

/** A rendered copy kept, with when it was made. */
interface Kept {
  at: number;
  copy: RenderedCopy;
}

/** The rendered copies kept for each running site, by the page's address. */
const keptFor = new WeakMap<object, Map<string, Kept>>();

/** The copies kept for the site `owner` runs. */
function keptBy(owner: object): Map<string, Kept> {
  const found = keptFor.get(owner);
  if (found !== undefined) return found;
  const kept = new Map<string, Kept>();
  keptFor.set(owner, kept);
  return kept;
}

/** The header a copy's own page request carries, so it is never answered with a copy. */
export const RENDERING_HEADER = "x-nextly-plain-copy";

/** `copy` kept for `address`, the oldest let go once there are too many. */
function keep(
  kept: Map<string, Kept>,
  address: string,
  copy: RenderedCopy
): void {
  kept.delete(address);
  kept.set(address, { at: Date.now(), copy });
  while (kept.size > KEPT_MAX) {
    const oldest = kept.keys().next().value;
    if (oldest === undefined) break;
    kept.delete(oldest);
  }
}

/**
 * The body of `response` as text, or null once it runs past `limit`
 * bytes: read piece by piece and given up there, so a page that does not
 * say its length is never read whole into memory.
 */
async function textWithin(
  response: Response,
  limit: number
): Promise<string | null> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let read = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    read += value.byteLength;
    if (read > limit) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
}

/**
 * What rendering a page gave: its copy, or why there is none, in words for
 * the problem list ("status 500", "timed out after 10 s").
 */
export type RenderedPage = { copy: RenderedCopy } | { failed: string };

/** Why a fetch that threw gave no page: the time allowed ran out, or no answer came. */
function thrownReason(error: unknown): string {
  return error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
    ? `timed out after ${RENDER_TIMEOUT_MS / 1000} s`
    : "the page could not be reached";
}

/**
 * The page at `address` rendered as the public sees it, as a copy: its
 * head's title and description, and its main content as Markdown, its
 * addresses made whole against `canonical`. Where the page does not answer
 * with HTML in time (a redirect, an error, a page too large, one with no
 * main content), why not. `owner`, the plugin's context, is the running
 * site the copy is kept for.
 */
export async function renderedCopyAt(
  owner: object,
  address: string,
  canonical: string
): Promise<RenderedPage> {
  const kept = keptBy(owner);
  const found = kept.get(address);
  if (found !== undefined && Date.now() - found.at < KEPT_MS) {
    return { copy: found.copy };
  }
  let response: Response;
  try {
    response = await fetch(address, {
      headers: { accept: "text/html", [RENDERING_HEADER]: "1" },
      redirect: "manual",
      signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
    });
  } catch (error) {
    return { failed: thrownReason(error) };
  }
  const type = response.headers.get("content-type") ?? "";
  const length = Number(response.headers.get("content-length") ?? "0");
  const refused =
    response.status !== 200
      ? `status ${response.status}`
      : !type.includes("text/html")
        ? "not an HTML page"
        : length > MAX_HTML_BYTES
          ? `over ${MAX_HTML_BYTES / (1024 * 1024)} MB`
          : undefined;
  if (refused !== undefined) {
    await response.body?.cancel();
    return { failed: refused };
  }
  // A body that stalls past the time allowed or breaks off midway is a page
  // that did not render, as a failure before its headers is: no copy, so
  // the caller falls back as it does for any page that does not render.
  let html: string | null;
  try {
    html = await textWithin(response, MAX_HTML_BYTES);
  } catch (error) {
    return { failed: thrownReason(error) };
  }
  if (html === null) {
    return { failed: `over ${MAX_HTML_BYTES / (1024 * 1024)} MB` };
  }
  const copy = renderedCopyOf(html, canonical);
  if (copy.body === "") return { failed: "no main content (<main>)" };
  keep(kept, address, copy);
  return { copy };
}
