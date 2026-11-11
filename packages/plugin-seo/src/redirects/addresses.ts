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
import { within } from "../address-record/rows";

/** A From address read: what is stored, and the address it holds. */
export type ParsedSource =
  | { ok: true; source: string; address: { path: string; range?: true } }
  | { ok: false; error: string };

const START_FROM = "Start the From address with /, for example /old-page.";
const STAR_FROM = "Use * only at the end of the From address, as in /old/*.";

/**
 * Whether a path has a `.` or `..` part, spelled plainly or encoded: a
 * browser resolves those before it asks, so a path with one is never what a
 * request arrives as, and a To address with one lands somewhere else.
 */
function hasDotPart(path: string): boolean {
  return path.split("/").some(part => {
    const plain = part.replace(/%2e/gi, ".");
    return plain === "." || plain === "..";
  });
}

/** Without a trailing slash, except the root's own. */
/**
 * A path spelled as a browser sends it and a URL reads it: `/café` is
 * `/caf%C3%A9`. Every address is kept in this spelling, so two spellings of
 * one address are one key, and the address a redirect sends a visitor to is
 * the very one its lookups followed.
 */
function spelled(path: string): string {
  return new URL(path, "https://address.invalid").pathname;
}

function trimmed(path: string): string {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

/**
 * The path a To address on this site sends a request to: without its query
 * or fragment and a trailing slash, since a request is matched by its path
 * alone. `/a?ref=1` is the address `/a`.
 */
export function pathOf(target: string): string {
  return trimmed(spelled(target.split(/[?#]/, 1)[0] ?? target));
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
  // A browser reads `\` as `/`, so an address with one is never asked for
  // as written.
  if (value.includes("\\")) {
    return { ok: false, error: "Use / rather than \\ in the From address." };
  }
  if (hasDotPart(value)) {
    return {
      ok: false,
      error: "Write the From address without . or .. parts.",
    };
  }
  const stars = value.split("*").length - 1;
  if (stars === 0) {
    const path = trimmed(spelled(value));
    return { ok: true, source: path, address: { path } };
  }
  if (stars > 1 || !value.endsWith("/*"))
    return { ok: false, error: STAR_FROM };
  if (value.slice(0, -2) === "") {
    return {
      ok: false,
      error: "A pattern needs a fixed part before the *, as in /old/*.",
    };
  }
  const base = spelled(value.slice(0, -2));
  return {
    ok: true,
    source: `${base}/*`,
    address: { path: base, range: true },
  };
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
  if (to.startsWith("/")) return sameSiteProblem(to, source);
  return elsewhereProblem(to);
}

/**
 * Why a To address on this site sends a request back where it started, or
 * null: to the From address itself, or, for a pattern, to any address the
 * pattern itself matches, which would redirect again and again.
 */
function sameSiteProblem(to: string, source: string): string | null {
  if (to.includes("\\")) return "Use / rather than \\ in the To address.";
  // Read as typed: the spelling a URL gives it has resolved them already.
  if (hasDotPart(to.split(/[?#]/, 1)[0] ?? to)) {
    return "Write the To address without . or .. parts.";
  }
  if (pathOf(to) === pathOf(source)) {
    return "That would send the address to itself.";
  }
  if (!source.endsWith("/*")) return null;
  const lands = pathOf(to.endsWith("/*") ? to.slice(0, -2) : to) || "/";
  return within(lands, pathOf(source.slice(0, -2)))
    ? `That makes a loop: ${source} would send its addresses back under itself.`
    : null;
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
  if (!to.startsWith("/")) return to;
  const at = to.search(/[?#]/);
  const path = spelled(at === -1 ? to : to.slice(0, at));
  const rest = at === -1 ? "" : to.slice(at);
  return `${path.endsWith("/*") ? path : trimmed(path)}${rest}`;
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
