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

/** How many redirects a request may follow before it is treated as a loop. */
const MAX_REDIRECTS = 3;
/** A response body larger than this is refused rather than buffered. */
const MAX_BODY_BYTES = 10 * 1024 * 1024;
/** How long one request may take, redirects included. */
const TIMEOUT_MS = 30_000;

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

function refuse(reason: string, context: Record<string, unknown>): never {
  throw NextlyError.forbidden({
    logContext: { reason: `outbound-${reason}`, ...context },
  });
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
): Promise<ResolvedAddress> {
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

  return answers[0];
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
    for (;;) {
      const address = await vetUrl(url, deps);
      const response = await deps.send({
        url,
        address,
        // `manual`, so a redirect comes back here to be checked rather than
        // being followed by the transport without one.
        init: { ...init, redirect: "manual" },
        deadlineAt,
        maxBodyBytes: MAX_BODY_BYTES,
      });

      const location = response.headers.get("location");
      const isRedirect = response.status >= 300 && response.status < 400;
      if (!isRedirect || !location) return response;

      if (remaining === 0) {
        refuse("too-many-redirects", { host: url.hostname });
      }
      remaining -= 1;
      try {
        url = new URL(location, url);
      } catch {
        refuse("malformed-redirect", { location });
      }
    }
  };
}
