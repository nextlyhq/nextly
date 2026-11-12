/**
 * The admin's startup request: the GETs a fresh tab makes before its first
 * screen's own data, sent as one request, `GET /startup?path=…`, which the
 * server answers part by part through each path's own route.
 *
 * A fresh tab used to make about a dozen of these one after another, in up to
 * five rounds (setup status, then the session, then the person, their
 * permissions, the navigation), each a full trip to the server. Now they go in
 * one trip, sent as soon as the admin's code starts, and each request the
 * screens make for one of these paths takes its answer from it, once.
 *
 * - Nothing about a screen changes: it asks for the same path through the
 *   same function, and gets the same response, only sooner.
 * - A part that was refused or failed is not used: that request goes to the
 *   server itself, so its own handling (a token refresh, an error) runs as
 *   it always has.
 * - A request for a path not in the startup request never waits for it.
 *
 * @module lib/api/startup-request
 */

/** One part of the answer, as the server sends it. */
interface StartupPart {
  path: string;
  status: number;
  body: unknown;
}

/** The startup request in flight, or answered: each part by its path. */
let answer: Promise<Map<string, StartupPart>> | null = null;
/** The paths it asked for, so a request for any other never waits for it. */
let asked: ReadonlySet<string> = new Set();
/** The parts already taken: each answers one request, the first to ask. */
const taken = new Set<string>();

/**
 * Send the startup request for `paths` (paths within the admin API, exactly
 * as the screens will ask for them), once per page. Does nothing on the
 * server, or when it has already been sent.
 */
export function beginStartupRequest(
  baseUrl: string,
  paths: readonly string[]
): void {
  if (answer !== null || typeof window === "undefined" || paths.length === 0) {
    return;
  }
  asked = new Set(paths);
  const query = paths.map(path => `path=${encodeURIComponent(path)}`).join("&");
  answer = fetch(`${baseUrl}/startup?${query}`, {
    credentials: "include",
    headers: { accept: "application/json" },
  })
    .then(response => (response.ok ? response.json() : null))
    .then((body: { parts?: StartupPart[] } | null) => {
      const parts = Array.isArray(body?.parts) ? body.parts : [];
      return new Map(parts.map(part => [part.path, part]));
    })
    // An unanswered startup request answers nothing: each request then goes
    // to the server itself, as it did before there was one.
    .catch(() => new Map<string, StartupPart>());
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
 * answer. The request is not sent again on this page.
 */
export function abandonStartupRequest(): void {
  asked = new Set();
}

/**
 * Forget the startup request, so the next page sends its own. For tests, which
 * load the admin many times in one process.
 *
 * @internal
 */
export function resetStartupRequestForTests(): void {
  answer = null;
  asked = new Set();
  taken.clear();
}
