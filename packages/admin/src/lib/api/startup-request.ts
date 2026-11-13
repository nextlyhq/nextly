/**
 * The admin's startup request: the GETs a fresh tab makes before its first
 * screen's own data, sent as one request, `GET /startup?path=…`, which the
 * server answers part by part through each path's own route.
 *
 * A fresh tab used to make about a dozen of these one after another, in up to
 * five rounds (setup status, then the session, then the person, their
 * permissions, the navigation), each a full trip to the server. Now they go in
 * one trip, and each request the screens make for one of these paths takes its
 * answer from it, once.
 *
 * It is sent before the admin's code has loaded: a small script in the
 * prebuilt page sends it as the browser reads the page
 * ({@link startEarlyStartupRequest}), and the admin, once its code runs,
 * takes that request and the paths it named rather than sending its own.
 * Where the script did not run (a policy that refused it, a page without it)
 * the admin sends the same request itself.
 *
 * - Nothing about a screen changes: it asks for the same path through the
 *   same function, and gets the same response, only sooner.
 * - A part that was refused or failed is not used: that request goes to the
 *   server itself, so its own handling (a token refresh, an error) runs as
 *   it always has.
 * - A request for a path not in the startup request never waits for it.
 * - A startup request the page's script sent that failed, or whose answer
 *   cannot be read, is sent again by the admin, once, without an error
 *   shown; if that fails too, each request goes to the server itself.
 *
 * @module lib/api/startup-request
 */

/** One part of the answer, as the server sends it. */
interface StartupPart {
  path: string;
  status: number;
  body: unknown;
}

/** A readable answer: its headers, and each part by its path. */
interface StartupAnswer {
  headers: Headers;
  parts: Map<string, StartupPart>;
}

/** The startup request in flight, or answered: each part by its path. */
let answer: Promise<Map<string, StartupPart>> | null = null;
/**
 * The startup answer's own headers, or null when it was not answered: they
 * carry what the server says of the whole admin (the versions its device
 * memory is labelled with, and whether the site lets it remember), which no
 * single part's answer does.
 */
let answerHeaders: Promise<Headers | null> | null = null;
/**
 * Settles {@link answerHeaders} ahead of the answer: with no answer, when the
 * startup request is abandoned, so nothing waits on headers that may never
 * come.
 */
let releaseHeaders: ((headers: Headers | null) => void) | null = null;
/** The paths it asked for, so a request for any other never waits for it. */
let asked: ReadonlySet<string> = new Set();
/** Whether it was abandoned for a retry, which it is then not sent again for. */
let abandoned = false;
/** The parts already taken: each answers one request, the first to ask. */
const taken = new Set<string>();

/**
 * Where the page's script leaves the startup request it sent, for the admin
 * to take: a property of `window`, as nothing else is shared between a script
 * in the page and the code that loads after it.
 */
export const EARLY_STARTUP_SLOT = "__nextlyAdminStartup";

/** What the page's script leaves in {@link EARLY_STARTUP_SLOT}. */
interface EarlyStartup {
  /** The paths it asked for, as the screens will ask for them. */
  paths: string[];
  /** Its response, as `fetch` gives it. */
  response: Promise<Response>;
}

/**
 * Send the startup request for `paths` and return `fetch`'s promise. The one
 * place the request is spelled: the admin calls it, and the page's script
 * runs its source text, so the two send the same request, credentials and
 * headers included. Kept free of closures and imports for that reason.
 */
export function sendStartupRequest(
  baseUrl: string,
  paths: readonly string[]
): Promise<Response> {
  const query = paths
    .map(function (path) {
      return "path=" + encodeURIComponent(path);
    })
    .join("&");
  return fetch(baseUrl + "/startup?" + query, {
    credentials: "include",
    headers: { accept: "application/json" },
  });
}

/**
 * Which paths the startup request names for the page at `pathname`: what
 * every screen needs first (`common`), and the reads the page declares, found
 * in `screensJson`, the plugin pages' startup reads the admin layout writes
 * into the page, at most `max` in all. The admin's `startupPathsForPage`; a
 * type here, as this module cannot import that one, which imports it.
 */
export type StartupPathsFor = (
  pathname: string,
  common: readonly string[],
  screensJson: string | null,
  max: number
) => string[];

/** What the page's script is written with when the page is built. */
export interface EarlyStartupPlan {
  /** The admin API's path on this origin (`API_PATH_PREFIX`). */
  apiPath: string;
  /** What every screen needs first (`adminStartupPaths`). */
  common: string[];
  /** The element the admin layout writes the plugin pages' startup reads in. */
  screensElementId: string;
  /** The most paths one startup request may name. */
  max: number;
  /** Where the request is left for the admin ({@link EARLY_STARTUP_SLOT}). */
  slot: string;
}

/**
 * The page's script: works out the paths for the page it is on with
 * `pathsFor`, sends the startup request with `send` (the sources of the
 * admin's own functions) and leaves it, with the paths it named, in the
 * plan's slot for the admin. Runs as the browser reads the prebuilt page,
 * before the admin's code has loaded, so it is kept free of closures and
 * imports, and nothing it does can throw: a script that fails leaves nothing,
 * and the admin sends the request itself.
 */
export function startEarlyStartupRequest(
  send: typeof sendStartupRequest,
  pathsFor: StartupPathsFor,
  plan: EarlyStartupPlan
): void {
  try {
    const screens = document.getElementById(plan.screensElementId);
    const paths = pathsFor(
      window.location.pathname,
      plan.common,
      screens === null ? null : screens.textContent,
      plan.max
    );
    const response = send(window.location.origin + plan.apiPath, paths);
    // A failure is the admin's to handle once it takes the request; until
    // then it is not reported as an error nobody handled.
    response.catch(function () {
      return undefined;
    });
    (window as unknown as Record<string, unknown>)[plan.slot] = {
      paths: paths,
      response: response,
    };
  } catch {
    // Nothing sent: the admin sends the startup request itself.
  }
}

/**
 * The startup request the page's script sent, taken from where it left it,
 * once: null when there is none, or what is there is not one.
 */
function takeEarlyStartup(): EarlyStartup | null {
  const slots = window as unknown as Record<string, unknown>;
  const left: unknown = slots[EARLY_STARTUP_SLOT];
  if (left === undefined) return null;
  delete slots[EARLY_STARTUP_SLOT];
  if (typeof left !== "object" || left === null) return null;
  const { paths, response } = left as Partial<
    Record<keyof EarlyStartup, unknown>
  >;
  if (
    !Array.isArray(paths) ||
    paths.length === 0 ||
    !paths.every((path): path is string => typeof path === "string") ||
    !(response instanceof Promise)
  ) {
    return null;
  }
  return { paths, response: response as Promise<Response> };
}

/**
 * A startup response read: its headers and parts, or null when it failed,
 * was refused as a whole, or its body is not a startup answer.
 */
async function readAnswer(
  sent: Promise<Response>
): Promise<StartupAnswer | null> {
  try {
    const response = await sent;
    if (!response.ok) return null;
    const body = (await response.json()) as { parts?: unknown } | null;
    if (!Array.isArray(body?.parts)) return null;
    const parts = body.parts as StartupPart[];
    return {
      headers: response.headers,
      parts: new Map(parts.map(part => [part.path, part])),
    };
  } catch {
    return null;
  }
}

/**
 * Send the startup request for `paths` (paths within the admin API, exactly
 * as the screens will ask for them), once per page; or, where the page's
 * script already sent it, take that one and the paths it named. Does nothing
 * on the server, or when it has already been sent.
 */
export function beginStartupRequest(
  baseUrl: string,
  paths: readonly string[]
): void {
  if (answer !== null || typeof window === "undefined") return;
  const early = takeEarlyStartup();
  // The script's paths, when it sent them: the parts handed out are then the
  // parts it asked for, whatever this code would have named.
  const named = early === null ? paths : early.paths;
  if (named.length === 0) return;
  asked = new Set(named);
  abandoned = false;
  const read: Promise<StartupAnswer | null> =
    early === null
      ? readAnswer(sendStartupRequest(baseUrl, named))
      : readAnswer(early.response).then(fromScript =>
          // The script's request failed or its answer cannot be read: sent
          // again from here, once, unless a retry gave up on it meanwhile.
          fromScript !== null || abandoned
            ? fromScript
            : readAnswer(sendStartupRequest(baseUrl, named))
        );
  answerHeaders = new Promise<Headers | null>(resolve => {
    releaseHeaders = resolve;
    // Never rejects: an unreadable answer settles it with none.
    void read.then(settled => resolve(settled?.headers ?? null));
  });
  // An unanswered startup request answers nothing: each request then goes to
  // the server itself, as it did before there was one.
  answer = read.then(settled => settled?.parts ?? new Map());
}

/**
 * The startup answer's headers once it answers; null when it was not sent on
 * this page, or was not answered.
 */
export function startupResponseHeaders(): Promise<Headers | null> {
  return answerHeaders ?? Promise.resolve(null);
}

/** Whether a part may stand in for its request: a success, by default. */
type AcceptPart = (part: { status: number; body: unknown }) => boolean;

const succeeded: AcceptPart = part => part.status >= 200 && part.status < 300;

/** Statuses whose response carries no body. */
const NO_BODY = new Set([204, 205, 304]);

/**
 * The startup request's answer for `path`, as a `Response`, the first time it
 * is asked for; `undefined`, at once, when the path was not asked for or was
 * already taken. The promise resolves to `undefined` when that part is not
 * one `accept` takes (by default, anything but a success), so the caller sends
 * its own request instead.
 */
export function takeStartupResponse(
  path: string,
  accept: AcceptPart = succeeded
): Promise<Response | undefined> | undefined {
  if (answer === null || !asked.has(path) || taken.has(path)) return undefined;
  taken.add(path);
  return answer.then(parts => {
    const part = parts.get(path);
    if (!part || !accept(part)) return undefined;
    return new Response(
      NO_BODY.has(part.status) ? null : JSON.stringify(part.body),
      {
        status: part.status,
        headers: { "content-type": "application/json" },
      }
    );
  });
}

/**
 * Stop handing out the startup request's answers: every part not yet taken is
 * asked of the server by its own request from now on. For a retry, which must
 * reach the server rather than wait on a startup request that may never
 * answer, its headers included. The request is not sent again on this page.
 */
export function abandonStartupRequest(): void {
  asked = new Set();
  abandoned = true;
  // Whoever waits on its headers is answered "none" at once, and asks the
  // server with a request of its own, as for an answer that never came.
  releaseHeaders?.(null);
  answerHeaders = Promise.resolve(null);
}

/**
 * Forget the startup request, so the next page sends its own. For tests, which
 * load the admin many times in one process.
 *
 * @internal
 */
export function resetStartupRequestForTests(): void {
  answer = null;
  answerHeaders = null;
  releaseHeaders = null;
  asked = new Set();
  abandoned = false;
  taken.clear();
}
