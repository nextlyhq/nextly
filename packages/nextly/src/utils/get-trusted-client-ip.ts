/**
 * Trusted client-IP resolution for Web `Request` objects.
 *
 * Audit C4 (T-005). The previous `getClientIp` helpers parsed
 * `X-Forwarded-For` unconditionally and returned the *leftmost* hop —
 * which a direct attacker can forge to defeat per-IP rate limits,
 * brute-force lockouts, and refresh-token IP binding.
 *
 * This helper applies the standard "rightmost-untrusted-hop" algorithm:
 *
 *   - When `trustProxy` is `false` (default), proxy headers are
 *     ignored entirely. Returns `null` because Web `Request` does not
 *     expose the immediate-peer IP.
 *
 *   - When `trustProxy` is `true`, walk `X-Forwarded-For` from the
 *     rightmost hop, skipping any value that matches `trustedProxyIps`
 *     (CIDR list). Return the first hop that is not in the trust list
 *     — that is the closest *untrusted* IP in the chain, i.e. the real
 *     client (or the closest claim of one).
 *
 *     If no `X-Forwarded-For` is present, fall back to `cf-connecting-ip`
 *     (Cloudflare) and `x-real-ip` (Nginx convention).
 *
 *     If every hop in the chain is in the trust list, return `null`
 *     rather than picking a trusted proxy as "the client".
 *
 * @module utils/get-trusted-client-ip
 */

import net from "node:net";

export interface TrustedClientIpOptions {
  /**
   * When false (default), proxy headers are ignored. When true,
   * `X-Forwarded-For` / `cf-connecting-ip` / `x-real-ip` are honored
   * subject to `trustedProxyIps`.
   */
  trustProxy: boolean;
  /**
   * CIDR list of proxy IPs that the application sits behind. Hops in
   * the `X-Forwarded-For` chain matching one of these CIDRs are
   * stripped during resolution; the first non-matching hop (walking
   * right-to-left) is returned as the client IP.
   *
   * IPv4 CIDR (`10.0.0.0/8`) and bare IPv4 addresses (`127.0.0.1`,
   * treated as `/32`) are fully supported. IPv6 entries are matched
   * exactly (no prefix masking) — sufficient for the common case
   * where proxy fleets advertise a small known IPv6 set.
   */
  trustedProxyIps?: readonly string[];
}

interface ParsedCidr {
  family: "ipv4" | "ipv6";
  /** For IPv4: the masked network address as uint32. For IPv6: the canonical lowercase address string. */
  network: number | string;
  /** For IPv4: prefix length (0–32). For IPv6: 128 (exact match only). */
  prefix: number;
}

/**
 * Resolve the client IP for a Web `Request`, applying the trust-proxy
 * gate described above. Returns `null` when no trusted IP can be
 * identified — callers should treat that as "unknown" rather than
 * picking a fallback like `127.0.0.1` (which would collapse all
 * unknown clients into one rate-limit bucket).
 */
export function getTrustedClientIp(
  request: Request,
  options: TrustedClientIpOptions
): string | null {
  if (!options.trustProxy) {
    return null;
  }

  const trustedCidrs = (options.trustedProxyIps ?? [])
    .map(parseCidr)
    .filter((c): c is ParsedCidr => c !== null);

  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const hops = xff
      .split(",")
      .map(h => h.trim())
      .filter(Boolean);
    for (let i = hops.length - 1; i >= 0; i--) {
      const hop = stripIpv6Brackets(hops[i]);
      if (!net.isIP(hop)) continue;
      if (!isIpInAnyCidr(hop, trustedCidrs)) {
        return hop;
      }
    }
    return null;
  }

  const cfIp = request.headers.get("cf-connecting-ip")?.trim();
  if (cfIp && net.isIP(cfIp)) {
    return cfIp;
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp && net.isIP(realIp)) {
    return realIp;
  }

  return null;
}

/**
 * Parse `TRUSTED_PROXY_IPS` env-var format: comma-separated CIDR list
 * with optional whitespace. Empty / unset → empty array.
 */
export function parseTrustedProxyIpsEnv(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

function stripIpv6Brackets(ip: string): string {
  return ip.startsWith("[") && ip.endsWith("]") ? ip.slice(1, -1) : ip;
}

function parseCidr(entry: string): ParsedCidr | null {
  const [addr, prefixRaw] = entry.split("/");
  const stripped = stripIpv6Brackets(addr);
  const family = net.isIP(stripped);
  if (family === 4) {
    const prefix = prefixRaw === undefined ? 32 : Number(prefixRaw);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
    const intAddr = ipv4ToInt(stripped);
    if (intAddr === null) return null;
    const mask = prefix === 0 ? 0 : (-1 >>> (32 - prefix)) << (32 - prefix);
    return { family: "ipv4", network: intAddr & mask, prefix };
  }
  if (family === 6) {
    // IPv6: exact match only. Reject CIDR-prefixed entries to avoid
    // silently matching too-wide ranges; if needed, callers can list
    // each address.
    if (prefixRaw !== undefined && prefixRaw !== "128") return null;
    return { family: "ipv6", network: stripped.toLowerCase(), prefix: 128 };
  }
  return null;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let acc = 0;
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    acc = (acc << 8) | n;
  }
  return acc >>> 0;
}

function isIpInAnyCidr(ip: string, cidrs: readonly ParsedCidr[]): boolean {
  if (cidrs.length === 0) return false;
  const family = net.isIP(ip);
  if (family === 4) {
    const intIp = ipv4ToInt(ip);
    if (intIp === null) return false;
    for (const c of cidrs) {
      if (c.family !== "ipv4") continue;
      const mask =
        c.prefix === 0 ? 0 : (-1 >>> (32 - c.prefix)) << (32 - c.prefix);
      if (((intIp & mask) >>> 0) === ((c.network as number) & mask) >>> 0) {
        return true;
      }
    }
    return false;
  }
  if (family === 6) {
    const lower = ip.toLowerCase();
    for (const c of cidrs) {
      if (c.family === "ipv6" && c.network === lower) return true;
    }
    return false;
  }
  return false;
}
