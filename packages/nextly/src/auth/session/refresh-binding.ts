/**
 * What changed about the client between a refresh token's issue and its
 * rotation.
 *
 * Compares the User-Agent and trusted client IP captured when the refresh
 * token was minted against the same values on the rotation request. Returns
 * one of:
 *
 *   - `{ kind: "ok" }`                  the same browser on the same network,
 *                                       or nothing to compare (a side is null
 *                                       or unparseable).
 *   - `{ kind: "changed", reasons }`    the network (another IP family, another
 *                                       /24 for IPv4 or /48 for IPv6) or the
 *                                       User-Agent changed.
 *
 * A change is reported, never refused. One browser's own requests reach a
 * site from more than one address as a matter of course: a carrier-grade NAT
 * or a connection with several uplinks sends each new connection out through
 * whichever public address it picks, often in another /24, and a dual-stack
 * browser connects over whichever IP family answers first. A refresh comes
 * after the tab has sat idle for the access token's lifetime, on a new
 * connection, so it is the request most likely to arrive from a new address.
 * Refusing it ended editors' sessions, on every device, within half an hour of
 * signing in, while a thief on the victim's own network, or behind the same
 * kind of NAT, passed it anyway. Browsers also change their User-Agent on
 * every update. The caller logs a change for an operator to watch.
 *
 * The addresses come from `getTrustedClientIp`, which only honors
 * `X-Forwarded-For` when `trustProxy` is on and the immediate proxy is in the
 * trusted CIDR list; without it both sides are null and nothing is compared.
 */

import { ipv4ToInt } from "../../utils/get-trusted-client-ip";

/** Why a rotation's client differs from the one its refresh token was issued to. */
export type RefreshBindingChange =
  | "ip-family-changed"
  | "ipv4-prefix-changed"
  | "ipv6-prefix-changed"
  | "user-agent-changed";

export type RefreshBindingResult =
  | { kind: "ok" }
  | { kind: "changed"; reasons: RefreshBindingChange[] };

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

function sameIpv4Prefix(a: string, b: string, prefix: number): boolean {
  const ai = ipv4ToInt(a);
  const bi = ipv4ToInt(b);
  if (ai === null || bi === null) return false;
  const mask = prefix === 0 ? 0 : (-1 >>> (32 - prefix)) << (32 - prefix);
  return (ai & mask) >>> 0 === (bi & mask) >>> 0;
}

/**
 * Expand an IPv6 address to 8 groups of 4 lowercase hex digits, then return
 * the leftmost `prefixBits / 4` hex characters as the prefix key. This avoids
 * pulling in a BigInt-based mask while staying correct for any prefix that
 * is a whole number of hex digits: the /48 the refresh binding compares, and
 * the /64 the plugin route rate limit keys by. Returns `null` if the input
 * cannot be parsed as IPv6.
 *
 * Handles `::`-collapsed forms and embedded IPv4 in the last 32 bits.
 */
export function ipv6PrefixHex(addr: string, prefixBits: number): string | null {
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
  const reasons: RefreshBindingChange[] = [];
  const network = compareIps(input.storedIp, input.currentIp);
  if (network !== null) reasons.push(network);
  if (
    input.storedUserAgent !== null &&
    input.currentUserAgent !== null &&
    input.storedUserAgent !== input.currentUserAgent
  ) {
    reasons.push("user-agent-changed");
  }
  return reasons.length === 0 ? { kind: "ok" } : { kind: "changed", reasons };
}

/** The first 96 bits of every IPv4-mapped IPv6 address, as 24 hex digits. */
const IPV4_MAPPED_PREFIX = `${"0".repeat(20)}ffff`;

/**
 * An IPv4 address written in its IPv6-mapped form, in any spelling
 * (`::ffff:198.51.100.7`, `::ffff:c633:6407`, `0:0:0:0:0:ffff:…`), as the
 * plain IPv4 address it names; any other address as it is. Read through the
 * one IPv6 expansion, so every spelling a dual-stack socket or proxy writes is
 * recognised, and the same address in two spellings is one address.
 */
function unmapIpv4(addr: string): string {
  if (!addr.includes(":")) return addr;
  const hex = ipv6PrefixHex(addr, 128);
  if (hex === null || !hex.startsWith(IPV4_MAPPED_PREFIX)) return addr;
  const v4 = Number.parseInt(hex.slice(IPV4_MAPPED_PREFIX.length), 16);
  return [24, 16, 8, 0].map(shift => (v4 >>> shift) & 0xff).join(".");
}

/** How the network changed, or `null` when it did not or cannot be told. */
function compareIps(
  storedIp: string | null,
  currentIp: string | null
): RefreshBindingChange | null {
  if (storedIp === null || currentIp === null) return null;
  const stored = unmapIpv4(storedIp);
  const current = unmapIpv4(currentIp);
  if (stored === current) return null;

  const sf = classifyIp(stored);
  const cf = classifyIp(current);
  if (sf === 0 || cf === 0) return null; // unparseable: nothing to compare
  if (sf !== cf) return "ip-family-changed";

  if (sf === 4) {
    return sameIpv4Prefix(stored, current, 24) ? null : "ipv4-prefix-changed";
  }
  return sameIpv6Prefix(stored, current, 48) ? null : "ipv6-prefix-changed";
}
