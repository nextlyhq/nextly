/**
 * `ctx.fetch` — outbound HTTP a plugin may only point at hosts it declared.
 *
 * Given to a plugin only when its manifest lists `capabilities.net.outbound`,
 * so reaching the network is something a plugin has to have ASKED for in a
 * place a reviewer reads before installing it.
 *
 * ## Why this is not `fetch` with a host check in front
 *
 * Checking the URL's hostname and then calling `fetch` leaves the lookup to
 * the transport, which does its own — so the name can resolve to a public
 * address for the check and an internal one for the request. That is DNS
 * rebinding, and it is the whole reason this file resolves the name itself,
 * vets every answer, and then connects to the address it vetted.
 *
 * Both halves matter. Vetting one answer while the transport picks another is
 * no better than not vetting; refusing the request when ANY answer is internal
 * is what makes a mixed answer safe.
 *
 * @module plugins/runtime/fetch
 * @since 1.0.0
 */
import { NextlyError } from "../../errors/nextly-error";

import { hostAllowed, judgeAddress } from "./address-rules";
import type { SendArgs } from "./transport";

/**
 * The statuses that are actually a redirect.
 *
 * The whole 3xx range is not: `304 Not Modified` and `305 Use Proxy` live
 * there too, and a `304` carrying a stale `Location` was being FOLLOWED —
 * the plugin got the redirected resource instead of the not-modified answer
 * it asked for, and a POST was rewritten to GET on the way. This is the set
 * `fetch` itself recognises.
 */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** How many redirects a request may follow before it is treated as a loop. */
const MAX_REDIRECTS = 3;
/** A response body larger than this is refused rather than buffered. */
const MAX_BODY_BYTES = 10 * 1024 * 1024;
/** How long one request may take, redirects included. */
const TIMEOUT_MS = 30_000;
/**
 * Request headers that do not survive a hop to another origin.
 *
 * Lower-case because that is how `Headers` reports names, and matching by a
 * name the caller chose to spell differently is exactly the miss that would
 * let a credential through.
 */
// An allowlist, not a denylist: APIs authenticate with headers of their own
// design (X-API-Key, X-Auth-Token, and every spelling a provider invents
// next), and a denylist enumerating today's names leaks tomorrow's to any
// host a redirect lands on. A cross-origin hop keeps only headers that are
// about the BODY or the transport — everything else is the caller's
// business with the first origin alone.
const CROSS_ORIGIN_SAFE_HEADERS = new Set([
  "accept",
  "accept-charset",
  "accept-language",
  "cache-control",
  "content-encoding",
  "content-type",
  "content-length",
  "if-match",
  "if-modified-since",
  "if-none-match",
  "if-range",
  "if-unmodified-since",
  "range",
  "user-agent",
]);
/**
 * Headers that describe the body rather than the request.
 *
 * Lower-case for the same reason as the set above: `Headers` reports names
 * that way, and matching a spelling the caller happened to choose is the miss
 * that would leave a stale `Content-Length` on a request carrying no body.
 */
const ENTITY_HEADERS = new Set([
  "content-encoding",
  "content-language",
  "content-length",
  "content-location",
  "content-type",
]);

/** One resolved address, as a DNS answer gives it. */
export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface PluginFetchDeps {
  /** Hosts this plugin declared. */
  allowlist: readonly string[];
  /** Every A/AAAA answer for a name. Injected so the rules are testable. */
  resolve: (hostname: string) => Promise<ResolvedAddress[]>;
  /**
   * Sends one request to a VETTED address.
   *
   * Typed as the transport's own argument object rather than restating its
   * fields: the two had already drifted once, and a second spelling of the
   * same shape is how a caller keeps passing an option the transport stopped
   * reading.
   */
  send: (request: SendArgs) => Promise<Response>;
  /** Development installs may reach localhost, for a fake provider in tests. */
  allowLoopback: boolean;
}

/**
 * The request the NEXT hop should carry.
 *
 * What a redirect does to the method and body is not a detail: 301, 302 and
 * 303 turn the follow-up into a bodyless GET, which is what keeps a credential
 * posted to one host from being posted again to another. 307 and 308 preserve
 * both by definition, which is what they are for.
 */
function nextHop(
  current: RequestInit,
  status: number,
  from: URL,
  to: URL
): RequestInit {
  // Same rule the platform applies: credentials are scoped to the origin they
  // were issued for, so a hop that leaves it drops them. Without this, a
  // compromised — or merely misconfigured — allowed host could redirect a
  // plugin's bearer token or session cookie to any OTHER allowed host, which
  // the allowlist does nothing to prevent because both ends are declared.
  const headers =
    from.origin === to.origin
      ? current.headers
      : stripCredentialHeaders(current.headers);

  const method = (current.method ?? "GET").toUpperCase();

  // Which methods a redirect rewrites is per STATUS, and there are three
  // cases rather than two. 307 and 308 exist precisely to preserve the
  // request, so they rewrite nothing. 303 means "fetch the result by GET", so
  // it rewrites whatever the request was. 301 and 302 rewrite only POST, for
  // historical compatibility — rewriting PUT, PATCH or DELETE as well turned
  // the caller's operation into a different one and dropped its body.
  const rewritesToGet =
    status === 307 || status === 308
      ? false
      : status === 303
        ? method !== "HEAD"
        : method === "POST";

  if (!rewritesToGet) {
    // The body is sent again, so it has to be replayable. A stream is consumed
    // by the first hop and would arrive empty at the second — refused rather
    // than silently truncated to nothing.
    if (current.body instanceof ReadableStream) {
      refuse("unreplayable-redirect-body", {
        host: to.hostname,
        status,
      });
    }
    return { ...current, headers };
  }

  const { body: _dropped, ...rest } = current;
  // Entity headers describe a body that is no longer being sent. Carrying a
  // `Content-Length` or `Content-Type` onto a bodyless GET leaves the framing
  // disagreeing with the request.
  return { ...rest, headers: stripEntityHeaders(headers), method: "GET" };
}

/** The headers that describe a body, dropped when the body is. */
function stripEntityHeaders(
  headers: RequestInit["headers"]
): Record<string, string> {
  const kept: Record<string, string> = {};
  const source = new Headers(headers ?? {});
  source.forEach((value, name) => {
    if (ENTITY_HEADERS.has(name.toLowerCase())) return;
    kept[name] = value;
  });
  return kept;
}

/** The request headers a cross-origin hop may keep. */
function stripCredentialHeaders(
  headers: RequestInit["headers"]
): Record<string, string> {
  // Normalized through `Headers` so every accepted spelling — a record, an
  // array of pairs, another `Headers` — is read the same way, and matching is
  // case-insensitive without doing that by hand.
  const kept: Record<string, string> = {};
  const source = new Headers(headers ?? {});
  source.forEach((value, name) => {
    if (!CROSS_ORIGIN_SAFE_HEADERS.has(name.toLowerCase())) return;
    kept[name] = value;
  });
  return kept;
}

function refuse(reason: string, context: Record<string, unknown>): never {
  throw NextlyError.forbidden({
    logContext: { reason: `outbound-${reason}`, ...context },
  });
}

/**
 * Hold `work` to what is left of the wall-clock budget.
 *
 * The transport bounds the socket, which leaves everything BEFORE the socket
 * unbounded — name resolution most of all. A resolver that never answers held
 * `ctx.fetch` open indefinitely without the request ever reaching the timer
 * that was supposed to cap it, so the documented bound was one the caller
 * could not rely on.
 */
async function withDeadline<T>(
  work: Promise<T>,
  deadlineAt: number,
  url: URL
): Promise<T> {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) {
    refuse("deadline-exceeded", { host: url.hostname });
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(
            NextlyError.forbidden({
              logContext: {
                reason: "outbound-deadline-exceeded",
                host: url.hostname,
              },
            })
          );
        }, remaining);
      }),
    ]);
  } finally {
    // Cleared on every exit, so a request that finished early does not hold
    // the event loop open for the remainder of its budget.
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * `https:` only, with one exception for a local development server.
 *
 * A fake identity provider in a test suite has no certificate, and requiring
 * one would mean the only way to test a plugin is to turn this off entirely.
 */
function assertUsableScheme(
  url: URL,
  isLocalhost: boolean,
  allowLoopback: boolean
): void {
  if (url.protocol === "https:") return;
  if (url.protocol === "http:" && isLocalhost && allowLoopback) return;
  refuse("scheme", { scheme: url.protocol, host: url.hostname });
}

/**
 * Judge EVERY answer, not the one that will be used.
 *
 * A name answering with one public address and one internal address is a
 * rebinding attempt whichever the transport happens to pick, so a single bad
 * answer refuses the request.
 */
function assertAnswersUsable(
  answers: readonly ResolvedAddress[],
  url: URL,
  isLocalhost: boolean,
  allowLoopback: boolean
): void {
  for (const answer of answers) {
    const verdict = judgeAddress(answer.address);
    if (verdict.allowed) continue;

    const loopbackInDev =
      verdict.reason === "loopback" && isLocalhost && allowLoopback;
    if (loopbackInDev) continue;

    refuse("address-refused", {
      host: url.hostname,
      address: answer.address,
      rule: verdict.reason,
    });
  }
}

/**
 * Check one URL, and return the address to send it to.
 *
 * Exported for the tests, because this is where every refusal is decided and
 * a redirect has to pass through exactly the same check as the first request.
 */
export async function vetUrl(
  url: URL,
  deps: PluginFetchDeps
): Promise<ResolvedAddress[]> {
  // `https:` only, with one exception for a local development server: a fake
  // identity provider in a test suite has no certificate, and requiring one
  // would mean the only way to test a plugin is to turn this off entirely.
  const isLocalhost =
    url.hostname === "localhost" || url.hostname === "127.0.0.1";
  assertUsableScheme(url, isLocalhost, deps.allowLoopback);

  if (!hostAllowed(url.hostname, deps.allowlist)) {
    refuse("host-not-declared", { host: url.hostname });
  }

  const answers = await deps.resolve(url.hostname);
  if (answers.length === 0) {
    refuse("unresolved", { host: url.hostname });
  }

  assertAnswersUsable(answers, url, isLocalhost, deps.allowLoopback);

  // Every answer, not just the first: a provider publishing several records
  // for failover expects a client to fall back when one is temporarily
  // unreachable, and pinning the first answer turned an ordinary outage of
  // a single host into an outage of the provider.
  return answers;
}

/**
 * Build the fetch a plugin is given.
 *
 * Redirects are followed here rather than by the transport, because each hop
 * is a new URL that has to pass the same checks — a destination that redirects
 * to `169.254.169.254` is the ordinary way this is attacked.
 */
export function createPluginFetch(
  deps: PluginFetchDeps
): (input: string | URL, init?: RequestInit) => Promise<Response> {
  return async function pluginFetch(input, init = {}) {
    let url: URL;
    try {
      url = input instanceof URL ? input : new URL(input);
    } catch {
      refuse("malformed-url", { input: String(input) });
    }

    let remaining = MAX_REDIRECTS;
    // Fixed BEFORE the loop, so every hop spends the same budget. Set inside,
    // each redirect would start a fresh thirty seconds and a chain of them
    // could hold a worker far past the bound this constant states.
    const deadlineAt = Date.now() + TIMEOUT_MS;
    // The request as it stands for THIS hop. A redirect may change it: the
    // original was replayed unchanged to every target, so an OAuth form or a
    // binary credential posted to one allowed host was re-sent verbatim to
    // whatever other allowed host it redirected to.
    let hop: RequestInit = init;
    for (;;) {
      // Inside the deadline AND against the caller's cancellation, because
      // the DNS lookup it performs is outside every timer this function
      // sets: a plugin that aborted because its own incoming request
      // disconnected would otherwise keep waiting on a stalled resolver
      // until the fixed budget answered for it. The lookup itself cannot
      // be interrupted, but the caller is released the moment it cancels.
      const addresses = await raceCallerAbort(
        withDeadline(vetUrl(url, deps), deadlineAt, url),
        init.signal ?? undefined
      );
      // Each vetted answer in turn: a provider publishing several records
      // for failover expects a client to fall back when one host is
      // temporarily unreachable, and pinning the first answer turned an
      // outage of a single host into an outage of the provider. Only a
      // failure to CONNECT moves to the next answer — a refused connection
      // is the failover case, while a completed HTTP exchange (any status)
      // and a policy refusal are answers in themselves.
      const response = await firstConnectedAddress(addresses, address =>
        deps.send({
          url,
          address,
          // `manual`, so a redirect comes back here to be checked rather than
          // being followed by the transport without one.
          init: { ...hop, redirect: "manual" },
          deadlineAt,
          maxBodyBytes: MAX_BODY_BYTES,
        })
      );

      const location = response.headers.get("location");
      if (!REDIRECT_STATUSES.has(response.status) || !location) {
        return response;
      }

      if (remaining === 0) {
        refuse("too-many-redirects", { host: url.hostname });
      }
      remaining -= 1;
      // Captured before `url` moves: whether this hop crosses an origin is
      // what decides if the request's credentials may travel with it.
      const from = url;
      try {
        url = new URL(location, url);
      } catch {
        refuse("malformed-redirect", { location });
      }
      hop = nextHop(hop, response.status, from, url);
    }
  };
}

/**
 * Release the caller the moment it cancels, whatever the underlying work
 * does.
 *
 * The DOMException shape `fetch` itself rejects with, so plugin code holding
 * an AbortSignal recognises its cancellation by name. The work is not
 * interrupted — a DNS query cannot be — but nothing awaits it either.
 */
function raceCallerAbort<T>(
  work: Promise<T>,
  signal: AbortSignal | undefined
): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () =>
      reject(new DOMException("This operation was aborted", "AbortError"));
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      value => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: Error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

/**
 * Send to each vetted address until one CONNECTS.
 *
 * A rejection from the send is a transport-level failure — connection
 * refused, reset, unreachable — which is exactly the case DNS failover
 * exists for; a completed exchange resolves with whatever status it
 * produced, and a policy refusal (NextlyError) has nothing to do with which
 * address was tried, so it propagates untouched. The last address's
 * rejection rethrows, so the caller sees the failure it would have seen
 * without the fallback.
 */
async function firstConnectedAddress(
  addresses: readonly ResolvedAddress[],
  send: (address: ResolvedAddress) => Promise<Response>
): Promise<Response> {
  let lastError: unknown;
  for (const address of addresses) {
    try {
      return await send(address);
    } catch (error) {
      if (NextlyError.is(error)) throw error;
      lastError = error;
    }
  }
  throw lastError;
}
