/**
 * Which addresses a plugin's outbound request may reach.
 *
 * A server that fetches a URL on someone else's behalf can be pointed at the
 * network it is standing in: the cloud metadata service that hands out
 * credentials, an internal admin panel with no authentication because it is
 * "not reachable from outside", a database port. That is SSRF, and a hostname
 * allowlist alone does not stop it — a name the plugin declared can resolve to
 * an internal address, and can resolve differently on the second lookup.
 *
 * So the decision is made about the resolved ADDRESS, and the request is sent
 * to the address that was vetted rather than to the name again.
 *
 * Kept pure and separate from the transport so every vector below can be
 * tested by value, with no sockets and no DNS.
 *
 * @module plugins/runtime/address-rules
 * @since 1.0.0
 */

/** Why an address was refused. Named, so a test asserts the rule that fired. */
export type AddressRefusal =
  | "unspecified"
  | "loopback"
  | "private"
  | "link-local"
  | "carrier-nat"
  | "benchmark"
  | "multicast"
  | "broadcast"
  | "reserved"
  | "unique-local"
  | "malformed";

export type AddressVerdict =
  | { allowed: true }
  | { allowed: false; reason: AddressRefusal };

const ALLOWED: AddressVerdict = { allowed: true };

function refuse(reason: AddressRefusal): AddressVerdict {
  return { allowed: false, reason };
}

/** The four octets of a dotted-quad, or null when it is not one. */
function ipv4Octets(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map(part =>
    /^\d{1,3}$/.test(part) ? Number(part) : Number.NaN
  );
  return octets.every(o => Number.isInteger(o) && o >= 0 && o <= 255)
    ? octets
    : null;
}

/**
 * Whether an IPv4 address is one a plugin may reach.
 *
 * Every refused range is a place a request can do damage while looking like an
 * ordinary fetch. `169.254.169.254` is the one worth naming: on most cloud
 * providers it answers with the instance's own credentials.
 */
export function judgeIpv4(address: string): AddressVerdict {
  const octets = ipv4Octets(address);
  if (!octets) return refuse("malformed");
  const [a, b] = octets;

  if (a === 0) return refuse("unspecified");
  if (a === 127) return refuse("loopback");
  if (a === 10) return refuse("private");
  if (a === 172 && b >= 16 && b <= 31) return refuse("private");
  if (a === 192 && b === 168) return refuse("private");
  if (a === 169 && b === 254) return refuse("link-local");
  if (a === 100 && b >= 64 && b <= 127) return refuse("carrier-nat");
  if (a === 192 && b === 0 && octets[2] === 0) return refuse("reserved");
  if (a === 198 && (b === 18 || b === 19)) return refuse("benchmark");
  if (a >= 224 && a <= 239) return refuse("multicast");
  if (octets.every(o => o === 255)) return refuse("broadcast");
  if (a >= 240) return refuse("reserved");

  return ALLOWED;
}

/** Expand an IPv6 address to its sixteen bytes, or null when it is malformed. */
function ipv6Bytes(address: string): number[] | null {
  let text = address.trim().toLowerCase();
  if (text.startsWith("[") && text.endsWith("]")) text = text.slice(1, -1);
  const zone = text.indexOf("%");
  if (zone !== -1) text = text.slice(0, zone);

  // A trailing dotted-quad (`::ffff:127.0.0.1`) is part of the address, so it
  // is folded into two groups rather than rejected as a stray IPv4.
  let tail: number[] = [];
  const lastColon = text.lastIndexOf(":");
  const maybeV4 = text.slice(lastColon + 1);
  if (maybeV4.includes(".")) {
    const octets = ipv4Octets(maybeV4);
    if (!octets) return null;
    tail = octets;
    text = text.slice(0, lastColon + 1) + "0:0";
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;

  const parse = (part: string): number[] | null => {
    if (part === "") return [];
    const groups = part.split(":");
    const out: number[] = [];
    for (const group of groups) {
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
      const value = Number.parseInt(group, 16);
      out.push((value >> 8) & 0xff, value & 0xff);
    }
    return out;
  };

  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  if (head === null || rest === null) return null;

  let bytes: number[];
  if (halves.length === 2) {
    // `tail` is NOT subtracted here: the dotted-quad was replaced above by a
    // two-group placeholder, so its four bytes are already counted in `rest`.
    // Subtracting them again shifts everything left, which put the `ffff` of
    // an IPv4-mapped address six bytes early and let `::ffff:127.0.0.1`
    // through as an ordinary public address.
    const fill = 16 - head.length - rest.length;
    if (fill < 0) return null;
    bytes = [...head, ...Array<number>(fill).fill(0), ...rest];
  } else {
    bytes = [...head, ...rest];
  }
  if (bytes.length !== 16) return null;
  // The placeholder occupies the last four bytes; put the real address back.
  if (tail.length > 0) bytes = [...bytes.slice(0, 12), ...tail];
  return bytes.length === 16 ? bytes : null;
}

/**
 * Whether an IPv6 address is one a plugin may reach.
 *
 * The embedded-IPv4 forms are the interesting part. `::ffff:127.0.0.1`,
 * `64:ff9b::7f00:1` and `2002:7f00:1::` are all ways of writing an IPv4
 * destination in IPv6 — each reaches 127.0.0.1 — so each is judged as the IPv4
 * address it carries rather than treated as an ordinary v6 address that
 * happens not to match any refused prefix.
 */
export function judgeIpv6(address: string): AddressVerdict {
  const bytes = ipv6Bytes(address);
  if (!bytes) return refuse("malformed");

  const asV4 = (offset: number) =>
    judgeIpv4(bytes.slice(offset, offset + 4).join("."));

  if (bytes.every(b => b === 0)) return refuse("unspecified");
  if (bytes.slice(0, 15).every(b => b === 0) && bytes[15] === 1) {
    return refuse("loopback");
  }

  // ::ffff:a.b.c.d — IPv4-mapped.
  if (
    bytes.slice(0, 10).every(b => b === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff
  ) {
    return asV4(12);
  }
  // ::a.b.c.d — IPv4-compatible, deprecated but still routed by some stacks.
  if (bytes.slice(0, 12).every(b => b === 0)) return asV4(12);
  // 64:ff9b::/96 — NAT64.
  if (
    bytes[0] === 0x00 &&
    bytes[1] === 0x64 &&
    bytes[2] === 0xff &&
    bytes[3] === 0x9b &&
    bytes.slice(4, 12).every(b => b === 0)
  ) {
    return asV4(12);
  }
  // 2002::/16 — 6to4 carries its IPv4 in the next four bytes.
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return asV4(2);

  if ((bytes[0] & 0xfe) === 0xfc) return refuse("unique-local");
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) {
    return refuse("link-local");
  }
  if (bytes[0] === 0xff) return refuse("multicast");

  return ALLOWED;
}

/** Judge an address of either family. */
export function judgeAddress(address: string): AddressVerdict {
  return address.includes(":") ? judgeIpv6(address) : judgeIpv4(address);
}

/**
 * Whether a host matches one allowlist entry.
 *
 * A leading `*.` matches a subdomain and NOT the bare domain, because those
 * are different hosts and a plugin that meant both can say both. The match is
 * on whole labels, so `example.com.evil.com` never matches `*.example.com`.
 */
export function hostMatches(host: string, pattern: string): boolean {
  const h = host.toLowerCase();
  const p = pattern.toLowerCase();
  if (p.startsWith("*.")) {
    const suffix = p.slice(1);
    return h.endsWith(suffix) && h.length > suffix.length;
  }
  return h === p;
}

/** Whether a host is on the allowlist at all. */
export function hostAllowed(
  host: string,
  allowlist: readonly string[]
): boolean {
  return allowlist.some(pattern => hostMatches(host, pattern));
}
