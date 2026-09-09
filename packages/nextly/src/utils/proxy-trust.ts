/**
 * One reader for how far a forwarded client address may be trusted.
 *
 * `security.trustProxy` decides whether proxy headers are read at all, and
 * `TRUSTED_PROXY_IPS` names the hops to walk past. Auth resolves a client
 * address for lockouts and audit; the collection write path resolves one for
 * hooks. Read separately, a deployment could end up strict about a login and
 * lax about a form submission that arrived on the same header.
 *
 * @module utils/proxy-trust
 */

import { parseTrustedProxyIpsEnv } from "./get-trusted-client-ip";
import type { TrustedClientIpOptions } from "./get-trusted-client-ip";

/** The resolved settings, in the shape {@link getTrustedClientIp} takes. */
export interface ProxyTrustSettings extends TrustedClientIpOptions {
  trustProxy: boolean;
  trustedProxyIps: string[];
}

/**
 * Read the proxy-trust settings from a registered config.
 *
 * `getConfig` is a thunk because both callers reach the config through a
 * container that throws before it is initialised. Anything unreadable resolves
 * to the closed default: proxy headers ignored, no trusted hops.
 */
export function readProxyTrustSettings(
  getConfig: () => unknown
): ProxyTrustSettings {
  return {
    trustProxy: readTrustProxy(getConfig),
    trustedProxyIps: parseTrustedProxyIpsEnv(process.env.TRUSTED_PROXY_IPS),
  };
}

function readTrustProxy(getConfig: () => unknown): boolean {
  try {
    const config = getConfig();
    if (config && typeof config === "object" && "security" in config) {
      const security = (config as { security?: unknown }).security;
      if (
        security &&
        typeof security === "object" &&
        "trustProxy" in security
      ) {
        return (security as { trustProxy?: unknown }).trustProxy === true;
      }
    }
    return false;
  } catch {
    return false;
  }
}
