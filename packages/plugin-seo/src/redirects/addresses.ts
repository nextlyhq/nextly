/**
 * The rules of a redirect's two addresses, with no database: what a From
 * address may be, where a To address may send people, which redirect answers
 * a requested address, and where it sends that request.
 *
 * A From address is a path on the site (`/old-page`), or a pattern (`/old/*`)
 * for that path and every path below it. A pattern is held in the address
 * record as a range, so the record decides which redirects an address meets.
 *
 * @module redirects/addresses
 */

/** A From address read: what is stored, and the address it holds. */
export type ParsedSource =
  | { ok: true; source: string; address: { path: string; range?: true } }
  | { ok: false; error: string };

const START_FROM = "Start the From address with /, for example /old-page.";
const STAR_FROM = "Use * only at the end of the From address, as in /old/*.";

/** Without a trailing slash, except the root's own. */
function trimmed(path: string): string {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

/**
 * Read a From address as a person typed it: refused with the reason to show
 * them, or the address it holds, a pattern as a range below its fixed part.
 */
export function parseSource(text: string): ParsedSource {
  const value = text.trim();
  if (value === "") return { ok: false, error: "Fill in the From address." };
  if (!value.startsWith("/") || value.startsWith("//")) {
    return { ok: false, error: START_FROM };
  }
  if (/\s/.test(value)) {
    return { ok: false, error: "The From address can't contain spaces." };
  }
  if (value.includes("?")) {
    return {
      ok: false,
      error: "Leave the ? and what follows it off the From address.",
    };
  }
  if (value.includes("#")) {
    return {
      ok: false,
      error: "Leave the # and what follows it off the From address.",
    };
  }
  const stars = value.split("*").length - 1;
  if (stars === 0) {
    const path = trimmed(value);
    return { ok: true, source: path, address: { path } };
  }
  if (stars > 1 || !value.endsWith("/*"))
    return { ok: false, error: STAR_FROM };
  const base = value.slice(0, -2);
  if (base === "") {
    return {
      ok: false,
      error: "A pattern needs a fixed part before the *, as in /old/*.",
    };
  }
  return { ok: true, source: value, address: { path: base, range: true } };
}

/**
 * Why a To address cannot be used for a redirect from `source`, or null. A
 * To address is a path on this site or a full https:// address, and may end
 * in `/*` only where the From address is a pattern.
 */
export function checkTarget(target: string, source: string): string | null {
  const to = target.trim();
  if (to === "") return "Fill in the To address.";
  if (/\s/.test(to)) return "The To address can't contain spaces.";
  if (to.startsWith("//")) {
    return "Start the To address with a single /, or use a full https:// address.";
  }
  const star = starProblem(to, source);
  if (star !== null) return star;
  if (to.startsWith("/")) {
    return trimmed(to) === trimmed(source)
      ? "That would send the address to itself."
      : null;
  }
  return elsewhereProblem(to);
}

/** Why a To address's `*` cannot be used, or null. */
function starProblem(to: string, source: string): string | null {
  if (!to.includes("*")) return null;
  if (!source.includes("*")) {
    return "The To address can only use * when the From address does.";
  }
  return to.split("*").length - 1 > 1 || !to.endsWith("/*")
    ? "Use * only at the end of the To address, as in /new/*."
    : null;
}

/** Why a To address on another site cannot be used, or null. */
function elsewhereProblem(to: string): string | null {
  if (/^http:\/\//i.test(to)) {
    return "Use https:// for an address on another site.";
  }
  if (!/^https:\/\//i.test(to)) {
    return "Start the To address with /, for example /blog, or use a full https:// address.";
  }
  let url: URL;
  try {
    url = new URL(to);
  } catch {
    return "That isn't a complete web address. Check it starts with https:// and then names a site.";
  }
  if (!url.hostname.includes(".") || url.hostname.endsWith(".")) {
    return "The To address is missing the site's name, like example.com.";
  }
  if (url.username !== "" || url.password !== "") {
    return "Remove the sign-in details from the To address.";
  }
  return null;
}

/** A To address as stored: without a trailing slash on a site path. */
export function storedTarget(target: string): string {
  const to = target.trim();
  return to.startsWith("/") && !to.endsWith("/*") ? trimmed(to) : to;
}

/**
 * Where a redirect sends a request for `path`: a pattern carries the rest of
 * the address below its fixed part across to a To address ending in `/*`,
 * and sends every address to one place where the To address has none.
 */
export function destinationOf(
  redirect: { source: string; target: string },
  path: string
): string {
  if (!redirect.source.endsWith("/*") || !redirect.target.endsWith("/*")) {
    return redirect.target;
  }
  const base = redirect.source.slice(0, -2);
  const rest = path.slice(base.length);
  const sent = redirect.target.slice(0, -2) + rest;
  return sent === "" ? "/" : sent;
}

/**
 * A row of the address record that meets a requested address: its path,
 * whether it is a range, and the redirect holding it, or null where a page
 * does.
 */
export interface HeldRow {
  path: string;
  range: boolean;
  redirect: string | null;
}

/** Whether `path` is `range` or below it. */
function within(path: string, range: string): boolean {
  return path === range || path.startsWith(range === "/" ? "/" : `${range}/`);
}

/**
 * The redirect that answers a request for `path`, given every record row at
 * or above it, or null where none does. An address a page holds, exactly or
 * in one of its ranges, is served and never redirected. Otherwise an exact
 * redirect answers before any pattern, and of the patterns covering it, the
 * one with the longest fixed part.
 */
export function pickRedirect(
  path: string,
  rows: readonly HeldRow[]
): string | null {
  const meeting = rows.filter(row =>
    row.range ? within(path, row.path) : row.path === path
  );
  if (meeting.some(row => row.redirect === null)) return null;
  const exact = meeting.find(row => !row.range);
  if (exact) return exact.redirect;
  let best: HeldRow | undefined;
  for (const row of meeting) {
    if (best === undefined || row.path.length > best.path.length) best = row;
  }
  return best?.redirect ?? null;
}
