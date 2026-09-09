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
  if (!request) return NO_REQUEST;

  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return {
    headers,
    // Frozen because every hook in the operation is handed this same object.
    // A hook that could rewrite the address would be rewriting what the hook
    // after it is asked to judge.
    http: Object.freeze({
      ip: getTrustedClientIp(request, readProxyTrustSettings(readConfig)),
      method: request.method,
    }),
  };
}

/** The registered config, or undefined before the container has one. */
function readConfig(): unknown {
  return container.has("config") ? container.get("config") : undefined;
}
