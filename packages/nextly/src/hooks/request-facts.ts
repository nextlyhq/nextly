/**
 * Turn the HTTP request behind an operation into the facts hooks are given.
 *
 * The core resolves; plugins decide. A hook is handed a client address that
 * already survived the deployment's proxy-trust rules and a marker that a
 * request happened at all, and it applies whatever policy it likes to those.
 * Resolving in each plugin instead would mean every plugin reading
 * `x-forwarded-for` itself, which is the forgeable read this exists to replace.
 *
 * @module hooks/request-facts
 */

import { container } from "../di/container";
import { getTrustedClientIp } from "../utils/get-trusted-client-ip";
import { readProxyTrustSettings } from "../utils/proxy-trust";

import { currentRequest } from "./request-scope";
import type { HookHttpFacts } from "./types";

/** The `req` fields a request contributes, ready to merge into a hook context. */
export interface ResolvedRequestFacts {
  headers?: Record<string, string>;
  http?: HookHttpFacts;
}

/** Nothing to say, shared so the no-request path allocates nothing per write. */
const NO_REQUEST: ResolvedRequestFacts = Object.freeze({});

/**
 * Resolve one request into hook facts.
 *
 * Returns an empty set when there is no request, which is what tells a
 * request-scoped rule to stand down rather than judge a seed script as if it
 * were a browser.
 */
export function resolveRequestFacts(
  request: Request | undefined
): ResolvedRequestFacts {
  // The caller's own request wins; otherwise the one the HTTP boundary pinned.
  // The fallback is what makes this reach a call path nobody threaded, which is
  // every path that reads or writes on the way to serving a request.
  const source = request ?? currentRequest();
  if (!source) return NO_REQUEST;

  const headers: Record<string, string> = {};
  source.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return {
    headers,
    // Frozen because every hook in the operation is handed this same object.
    // A hook that could rewrite the address would be rewriting what the hook
    // after it is asked to judge.
    http: Object.freeze({
      ip: getTrustedClientIp(source, readProxyTrustSettings(readConfig)),
      method: source.method,
    }),
  };
}

/** The registered config, or undefined before the container has one. */
function readConfig(): unknown {
  return container.has("config") ? container.get("config") : undefined;
}

/**
 * The client address behind a request, under this deployment's proxy trust.
 *
 * @public
 *
 * `getTrustedClientIp` is exported beside this and takes the settings as an
 * argument, which a plugin cannot supply: they are read from the running
 * configuration through the container. Exported as a pair, the resolver was
 * reachable and unusable, so a plugin needing an address had the choice of
 * reading `x-forwarded-for` itself, which is the forgeable read the resolver
 * exists to replace.
 *
 * `null` when the deployment does not trust a proxy, or when no request
 * produced this work. Both mean the same thing to a caller: there is no address
 * here worth acting on. A rule that treats `null` as a distinct visitor is
 * reading a value that was never a visitor at all.
 *
 * The request may be omitted inside anything Nextly pins one around, including
 * a plugin route handler, and the ambient one is used.
 */
export function trustedClientIp(request?: Request): string | null {
  return resolveRequestFacts(request).http?.ip ?? null;
}
