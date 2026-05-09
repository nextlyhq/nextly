/**
 * Refresh-token session binding policy.
 *
 * Compares the User-Agent and trusted client IP captured at refresh-token
 * mint time against the same values on the rotation request. Returns one of:
 *
 *   - `{ kind: "ok" }`            values match (or comparison is impossible
 *                                 because one side is null / unparseable).
 *   - `{ kind: "soft", reason }`  UA mismatch only. Browsers update User-
 *                                 Agent strings via auto-update, so this is
 *                                 logged but not enforced.
 *   - `{ kind: "hard", reason }`  IP family flip (v4 to v6) or network-prefix
 *                                 change (different /24 for IPv4, /48 for
 *                                 IPv6). Caller must revoke the user's
 *                                 refresh tokens and force re-auth.
 *
 * The /24 (v4) and /48 (v6) tolerances accept benign mobile-carrier and ISP
 * rotations while still catching cross-network theft. They are conservative
 * by design; a hard-fail forces a fresh login, not data loss, so a slightly
 * higher false-positive rate is acceptable.
 *
 * Safety note: this policy assumes IP values come from `getTrustedClientIp`,
 * which only honors `X-Forwarded-For` when `trustProxy` is on and the
 * immediate proxy is in the trusted CIDR list. Without that guarantee, a
 * direct attacker could spoof the IP and either bypass the binding (by
 * matching the stored IP) or weaponise the hard-fail to forcibly log other
 * users out.
 */

export type RefreshBindingResult =
  | { kind: "ok" }
  | { kind: "soft"; reason: string }
  | { kind: "hard"; reason: string };

export interface RefreshBindingInput {
  storedUserAgent: string | null;
  currentUserAgent: string | null;
  storedIp: string | null;
  currentIp: string | null;
}

const IPV4_RE =
  /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const IPV6_CHAR_RE = /^[0-9a-fA-F:.]+$/;

type IpFamily = 4 | 6 | 0;

function classifyIp(addr: string): IpFamily {
  if (IPV4_RE.test(addr)) return 4;
  if (addr.includes(":") && IPV6_CHAR_RE.test(addr) && addr.length <= 45) {
    return 6;
  }
  return 0;
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

function sameIpv4Prefix(a: string, b: string, prefix: number): boolean {
  const ai = ipv4ToInt(a);
  const bi = ipv4ToInt(b);
  if (ai === null || bi === null) return false;
  const mask = prefix === 0 ? 0 : (-1 >>> (32 - prefix)) << (32 - prefix);
  return ((ai & mask) >>> 0) === ((bi & mask) >>> 0);
}

/**
 * Expand an IPv6 address to 8 groups of 4 lowercase hex digits, then return
 * the leftmost `prefixBits / 4` hex characters as the prefix key. This avoids
 * pulling in a BigInt-based mask while still being correct for the /48
 * prefix used here (12 hex chars). Returns `null` if the input cannot be
 * parsed as IPv6.
 *
 * Handles `::`-collapsed forms and embedded IPv4 in the last 32 bits.
 */
function ipv6PrefixHex(addr: string, prefixBits: number): string | null {
  if (prefixBits % 4 !== 0) return null;
  const hexCount = prefixBits / 4;

  let work = addr.toLowerCase();
  // Embedded IPv4 (e.g. "::ffff:1.2.3.4"); expand the dotted-quad to two
  // hex groups so the rest of the routine treats it uniformly.
  const dottedMatch = work.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dottedMatch) {
    const v4 = ipv4ToInt(dottedMatch[2]);
    if (v4 === null) return null;
    const high = ((v4 >>> 16) & 0xffff).toString(16);
    const low = (v4 & 0xffff).toString(16);
    work = `${dottedMatch[1]}${high}:${low}`;
  }

  const doubleColon = work.split("::");
  if (doubleColon.length > 2) return null;

  let groups: string[];
  if (doubleColon.length === 2) {
    const left = doubleColon[0] === "" ? [] : doubleColon[0].split(":");
    const right = doubleColon[1] === "" ? [] : doubleColon[1].split(":");
    if (left.length + right.length > 8) return null;
    const fill = new Array(8 - left.length - right.length).fill("0");
    groups = [...left, ...fill, ...right];
  } else {
    groups = work.split(":");
    if (groups.length !== 8) return null;
  }

  let out = "";
  for (const g of groups) {
    if (!/^[0-9a-f]{0,4}$/.test(g)) return null;
    out += g.padStart(4, "0");
    if (out.length >= hexCount) break;
  }
  return out.slice(0, hexCount);
}

function sameIpv6Prefix(a: string, b: string, prefix: number): boolean {
  const ah = ipv6PrefixHex(a, prefix);
  const bh = ipv6PrefixHex(b, prefix);
  if (ah === null || bh === null) return false;
  return ah === bh;
}

export function evaluateRefreshBinding(
  input: RefreshBindingInput
): RefreshBindingResult {
  const ipResult = compareIps(input.storedIp, input.currentIp);
  if (ipResult !== null) {
    return { kind: "hard", reason: ipResult };
  }

  if (
    input.storedUserAgent !== null &&
    input.currentUserAgent !== null &&
    input.storedUserAgent !== input.currentUserAgent
  ) {
    return { kind: "soft", reason: "ua-mismatch" };
  }

  return { kind: "ok" };
}

/** Returns a hard-fail reason or `null` if the IP comparison is acceptable. */
function compareIps(stored: string | null, current: string | null): string | null {
  if (stored === null || current === null) return null;
  if (stored === current) return null;

  const sf = classifyIp(stored);
  const cf = classifyIp(current);
  if (sf === 0 || cf === 0) return null; // unparseable; don't enforce
  if (sf !== cf) return "ip-family-mismatch";

  if (sf === 4) {
    return sameIpv4Prefix(stored, current, 24) ? null : "ipv4-prefix-mismatch";
  }
  return sameIpv6Prefix(stored, current, 48) ? null : "ipv6-prefix-mismatch";
}
