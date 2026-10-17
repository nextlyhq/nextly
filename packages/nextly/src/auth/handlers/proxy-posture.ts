/**
 * What a deployment's proxy settings do to the auth rate limit, said where an
 * operator will read it.
 *
 * With no client address to key on, the auth limiter counts a request against
 * the account it names, under a ceiling every such request shares (see
 * `auth/handlers/unknown-source`). That is the safe default, but a deployment
 * behind a proxy that does report the client usually wants per-client limits,
 * and nothing about a working sign-in shows it is on the fallback. Two
 * warnings say so: one at startup on a platform whose edge is known to report
 * the client, and one the first time a request arrives through a proxy whose
 * report could not be used.
 *
 * @module auth/handlers/proxy-posture
 */
import { getNextlyLogger } from "../../observability/logger";
import { carriesClientIpHeader } from "../../utils/get-trusted-client-ip";
import { readProxyTrustSettings } from "../../utils/proxy-trust";

import { readAuthRateLimit } from "./deps-bridge";

/** The environment variables a platform is recognised by. */
type PlatformEnv = Readonly<Record<string, string | undefined>>;

/**
 * Platforms whose edge always overwrites the client-address headers with the
 * client's own address, so trusting them there cannot be spoofed by a caller.
 *
 * Vercel's request-header documentation states that its edge overwrites
 * `x-forwarded-for` with the client's public address and does not forward an
 * address a caller supplied. A platform joins this list only on the same
 * documented guarantee.
 */
const REWRITING_EDGES: ReadonlyArray<{
  name: string;
  runsHere: (env: PlatformEnv) => boolean;
}> = [{ name: "Vercel", runsHere: env => env.VERCEL === "1" }];

/**
 * The startup warning owed when the app runs on a rewriting edge with
 * `security.trustProxy` unset, or `null` when none is owed.
 */
export function edgeProxyWarning(
  config: unknown,
  env: PlatformEnv = process.env
): string | null {
  if (readProxyTrustSettings(() => config).trustProxy) return null;
  // A budget of zero turns the auth limiter off, so there is no counting to
  // describe; the same reader the router's budget comes from says so.
  if (readAuthRateLimit(() => config).requestsPerHour <= 0) return null;
  const edge = REWRITING_EDGES.find(candidate => candidate.runsHere(env));
  if (!edge) return null;
  return (
    `[nextly] Running on ${edge.name} with security.trustProxy unset, so no ` +
    "client address is read from a request. The auth rate limit then counts " +
    "each request against the account it names, under a ceiling every such " +
    `request shares, rather than per client. ${edge.name}'s edge overwrites ` +
    "x-forwarded-for with the address of whoever reached it: when that is " +
    "the client, set security.trustProxy: true to make client addresses " +
    `resolvable here. If another proxy or CDN sits in front of ${edge.name}, ` +
    "that address is the proxy's, and every client would share one budget, " +
    `so pass the client's address through ${edge.name}'s Trusted Proxy ` +
    "support first, or leave the setting off."
  );
}

/** Whether this process has already said the fallback is catching requests. */
let fallbackReported = false;

/**
 * Note an auth request the limiter could not resolve a client address for.
 *
 * Logs once per process, and only for a request that carries a
 * client-address header: those are the requests a setting could move off
 * the fallback. The header alone does not show a proxy sent it, since a
 * client can set it too, so the message says to trust it only behind a
 * proxy every request passes through. A request with no such header was
 * never going to resolve, and says nothing about the settings.
 */
export function noteUnresolvedAuthRequest(request: Request): void {
  if (fallbackReported || !carriesClientIpHeader(request)) return;
  fallbackReported = true;
  getNextlyLogger().warn({
    kind: "auth-rate-limit-unresolved-client",
    message:
      "Auth requests are arriving with proxy client-address headers that " +
      "could not be used, so the auth rate limit is counting them by the " +
      "account each names, under a shared ceiling, rather than per client. " +
      "A client can send these headers itself, so they do not show a proxy " +
      "is in front: only if every request reaches the app through a proxy " +
      "you control that sets them, set security.trustProxy: true, and list " +
      "any hops in front of that proxy in TRUSTED_PROXY_IPS. Otherwise leave " +
      "it off. Logged once per process.",
    settings: ["security.trustProxy", "TRUSTED_PROXY_IPS"],
  });
}
