/**
 * The one way the server reaches the font catalogue: only the hosts named in
 * config, only https, and only an answer that is what was asked for.
 *
 * Layered over `ctx.fetch`, which already resolves names itself and refuses
 * internal addresses. These checks are the route's own because they decide
 * what a font add may store, and a test that stubs the transport must still
 * be able to prove them:
 *
 * - the address is built on the server, and must sit on one of the configured
 *   hosts exactly (scheme, host and port), with no name or password in it;
 * - a redirect is never followed by the transport; it is followed here, at
 *   most twice, and only to another address on those hosts;
 * - the time allowed covers the whole request, the body included;
 * - the body is counted as it streams and refused past the cap, whatever its
 *   stated length says;
 * - a font must be served as `font/woff2` and begin with the woff2 signature.
 *
 * A refusal never carries the other server's words, only a status and a host.
 *
 * @module site-fonts/guarded-fetch
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";

/** The transport: `ctx.fetch`, or a stand-in in a test. */
export type CatalogueFetch = (
  input: string,
  init?: RequestInit
) => Promise<Response>;

/** What one fetch may reach, and what it must answer with. */
export interface CatalogueFetchRules {
  /** The configured hosts, as origins. Nothing else is reachable. */
  readonly allowed: readonly URL[];
  /** Whether plain http on `localhost` may be reached, for a test catalogue. */
  readonly allowLoopback: boolean;
  /** The most bytes the answer may have. */
  readonly maxBytes: number;
  /** How long the request may take, body included. */
  readonly timeoutMs: number;
  /** A json answer from the api, or a woff2 file. */
  readonly expect: "json" | "woff2";
  /** What the caller is told when an answer is refused, or never comes. */
  readonly messages: { readonly refused: string; readonly unanswered: string };
  /** A wider deadline this request also stops at, such as a whole add's. */
  readonly signal?: AbortSignal;
  /** What a 404 means to this caller, when it means more than "no answer". */
  readonly notFound?: () => NextlyError;
  /**
   * What passing `maxBytes` means to this caller, when the cap is a share of
   * a larger budget rather than the answer's own limit.
   */
  readonly tooLarge?: () => NextlyError;
}

/** The statuses that are a redirect, as `fetch` itself reads them. */
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** How many redirects one request may follow. */
const MAX_REDIRECTS = 2;

/** The first four bytes of every woff2 file. */
const WOFF2_SIGNATURE = [0x77, 0x4f, 0x46, 0x32];

/** What each kind of answer must be served as. */
const CONTENT_TYPES = {
  json: /^application\/json\s*(?:;|$)/i,
  woff2: /^font\/woff2\s*(?:;|$)/i,
} as const;

/** Why an answer was refused, and which message the caller is given. */
type Refusal =
  | "host-not-allowed"
  | "redirect-not-allowed"
  | "too-many-redirects"
  | "too-large"
  | "wrong-type"
  | "not-woff2";

type Unanswered = "status" | "timeout" | "network";

/**
 * Fetch one catalogue address under the rules, answering its bytes.
 *
 * @throws NextlyError `SERVICE_UNAVAILABLE` with the caller's message, and the
 *   reason, host and status in the log context
 */
export async function fetchFromCatalogue(
  fetch: CatalogueFetch,
  url: string,
  rules: CatalogueFetchRules
): Promise<Uint8Array> {
  let target = allowedUrl(url, rules);
  const deadline = deadlineOf(rules);
  try {
    for (let hop = 0; ; hop += 1) {
      const response = await answerOf(fetch, target, deadline.signal, rules);
      if (!REDIRECTS.has(response.status)) {
        return await bodyOf(response, target, deadline.signal, rules);
      }
      if (hop === MAX_REDIRECTS) {
        throw refused(rules, "too-many-redirects", target);
      }
      target = redirectTarget(response, target, rules);
    }
  } finally {
    deadline.clear();
  }
}

/** The address, when it sits exactly on a configured host; refused if not. */
function allowedUrl(raw: string, rules: CatalogueFetchRules): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw refused(rules, "host-not-allowed", undefined);
  }
  const loopback =
    rules.allowLoopback &&
    url.protocol === "http:" &&
    url.hostname === "localhost";
  const usable =
    (url.protocol === "https:" || loopback) &&
    url.username === "" &&
    url.password === "" &&
    rules.allowed.some(host => host.origin === url.origin);
  if (!usable) throw refused(rules, "host-not-allowed", url);
  return url;
}

/** A redirect's target, when it stays on the configured hosts. */
function redirectTarget(
  response: Response,
  from: URL,
  rules: CatalogueFetchRules
): URL {
  const location = response.headers.get("location");
  let next: URL | undefined;
  try {
    next = location === null ? undefined : new URL(location, from);
  } catch {
    next = undefined;
  }
  if (next === undefined) throw refused(rules, "redirect-not-allowed", from);
  try {
    return allowedUrl(next.href, rules);
  } catch {
    throw refused(rules, "redirect-not-allowed", next);
  }
}

/**
 * One deadline for the request and its body, under the caller's wider one.
 * A timer rather than `AbortSignal.timeout`, so it is cleared once the answer
 * is in and does not hold the process open.
 */
function deadlineOf(rules: CatalogueFetchRules): {
  signal: AbortSignal;
  clear: () => void;
} {
  const controller = new AbortController();
  const stop = (): void => controller.abort();
  const timer = setTimeout(stop, rules.timeoutMs);
  rules.signal?.addEventListener("abort", stop, { once: true });
  if (rules.signal?.aborted === true) stop();
  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timer);
      rules.signal?.removeEventListener("abort", stop);
    },
  };
}

/** The transport's answer to one hop, with a failure said in plain words. */
async function answerOf(
  fetch: CatalogueFetch,
  url: URL,
  signal: AbortSignal,
  rules: CatalogueFetchRules
): Promise<Response> {
  try {
    return await fetch(url.href, {
      method: "GET",
      redirect: "manual",
      signal,
      headers: {
        accept: rules.expect === "json" ? "application/json" : "font/woff2",
      },
    });
  } catch (error) {
    throw unanswered(rules, signal.aborted ? "timeout" : "network", url, {
      cause: error instanceof Error ? error : undefined,
    });
  }
}

/** The answer's body, once its status, type, size and signature are right. */
async function bodyOf(
  response: Response,
  url: URL,
  signal: AbortSignal,
  rules: CatalogueFetchRules
): Promise<Uint8Array> {
  if (response.status === 404 && rules.notFound !== undefined) {
    throw rules.notFound();
  }
  if (response.status !== 200) {
    throw unanswered(rules, "status", url, { status: response.status });
  }
  const type = response.headers.get("content-type") ?? "";
  if (!CONTENT_TYPES[rules.expect].test(type)) {
    throw refused(rules, "wrong-type", url, { type });
  }
  const stated = Number(response.headers.get("content-length"));
  if (Number.isFinite(stated) && stated > rules.maxBytes) {
    throw overCap(rules, url);
  }
  const bytes = await readCapped(response, url, signal, rules);
  if (
    rules.expect === "woff2" &&
    !WOFF2_SIGNATURE.every((byte, index) => bytes[index] === byte)
  ) {
    throw refused(rules, "not-woff2", url);
  }
  return bytes;
}

/**
 * The body, read a chunk at a time and abandoned the moment it passes the
 * cap or the deadline. A stated length can be absent or wrong, so only what
 * actually arrives is counted.
 */
async function readCapped(
  response: Response,
  url: URL,
  signal: AbortSignal,
  rules: CatalogueFetchRules
): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (reader === undefined) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  const aborted = new Promise<never>((_resolve, reject) => {
    const stop = (): void => reject(unanswered(rules, "timeout", url));
    if (signal.aborted) stop();
    else signal.addEventListener("abort", stop, { once: true });
  });
  // Observed so an abort after the body is read raises no unhandled rejection.
  aborted.catch(() => undefined);
  try {
    for (;;) {
      const chunk = await Promise.race([reader.read(), aborted]);
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > rules.maxBytes) throw overCap(rules, url);
      chunks.push(chunk.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (NextlyError.is(error)) throw error;
    throw unanswered(rules, "network", url);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}

/** An answer past its cap, in the caller's words when it gave some. */
function overCap(rules: CatalogueFetchRules, url: URL): NextlyError {
  return rules.tooLarge?.() ?? refused(rules, "too-large", url);
}

/** An answer refused for what it was. */
function refused(
  rules: CatalogueFetchRules,
  reason: Refusal,
  url: URL | undefined,
  context: Record<string, unknown> = {}
): NextlyError {
  return NextlyError.serviceUnavailable({
    publicMessage: rules.messages.refused,
    logMessage: `The font catalogue's answer was refused (${reason}).`,
    logContext: { reason, host: url?.host, ...context },
  });
}

/** An answer that never came, or came as a failure. */
function unanswered(
  rules: CatalogueFetchRules,
  reason: Unanswered,
  url: URL,
  extra: { status?: number; cause?: Error } = {}
): NextlyError {
  return NextlyError.serviceUnavailable({
    publicMessage: rules.messages.unanswered,
    logMessage: `The font catalogue did not answer (${reason}).`,
    logContext: { reason, host: url.host, status: extra.status },
    ...(extra.cause === undefined ? {} : { cause: extra.cause }),
  });
}
