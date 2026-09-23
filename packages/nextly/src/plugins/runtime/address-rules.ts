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
/**
 * The ranges a plugin may not reach, as data rather than a branch chain.
 *
 * A table because the list is the specification: each entry reads as the rule
 * it encodes, and adding one is a line rather than another `if` in a function
 * that already had a dozen. `169.254.169.254` falls under link-local, and is
 * the one worth knowing about — on most cloud providers it answers with the
 * instance's own credentials.
 */
const REFUSED_IPV4: ReadonlyArray<{
  reason: AddressRefusal;
  matches: (octets: number[]) => boolean;
}> = [
  { reason: "unspecified", matches: ([a]) => a === 0 },
  { reason: "loopback", matches: ([a]) => a === 127 },
  { reason: "private", matches: ([a]) => a === 10 },
  { reason: "private", matches: ([a, b]) => a === 172 && b >= 16 && b <= 31 },
  { reason: "private", matches: ([a, b]) => a === 192 && b === 168 },
  { reason: "link-local", matches: ([a, b]) => a === 169 && b === 254 },
  {
    reason: "carrier-nat",
    matches: ([a, b]) => a === 100 && b >= 64 && b <= 127,
  },
  {
    reason: "reserved",
    matches: ([a, b, c]) => a === 192 && b === 0 && c === 0,
  },
  {
    reason: "benchmark",
    matches: ([a, b]) => a === 198 && (b === 18 || b === 19),
  },
  { reason: "multicast", matches: ([a]) => a >= 224 && a <= 239 },
  { reason: "broadcast", matches: o => o.every(part => part === 255) },
  { reason: "reserved", matches: ([a]) => a >= 240 },
];

/** Whether an IPv4 address is one a plugin may reach. */
export function judgeIpv4(address: string): AddressVerdict {
  const octets = ipv4Octets(address);
  if (!octets) return refuse("malformed");

  const hit = REFUSED_IPV4.find(rule => rule.matches(octets));
  return hit ? refuse(hit.reason) : ALLOWED;
}

/** The two bytes of one hex group, or null when it is not one. */
function hexGroupBytes(group: string): number[] | null {
  if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
  const value = Number.parseInt(group, 16);
  return [(value >> 8) & 0xff, value & 0xff];
}

/** Every byte of a colon-separated run, or null when any group is malformed. */
function parseGroups(part: string): number[] | null {
  if (part === "") return [];
  const out: number[] = [];
  for (const group of part.split(":")) {
    const bytes = hexGroupBytes(group);
    if (!bytes) return null;
    out.push(...bytes);
  }
  return out;
}

/**
 * Replace a trailing dotted-quad with a two-group placeholder.
 *
 * `::ffff:127.0.0.1` is one address, not an IPv6 address with a stray IPv4 on
 * the end, so the quad is folded into the group count here and written back
 * over the last four bytes afterwards.
 */
function splitEmbeddedIpv4(
  text: string
): { text: string; tail: number[] } | null {
  const lastColon = text.lastIndexOf(":");
  const candidate = text.slice(lastColon + 1);
  if (!candidate.includes(".")) return { text, tail: [] };

  const octets = ipv4Octets(candidate);
  if (!octets) return null;
  return { text: `${text.slice(0, lastColon + 1)}0:0`, tail: octets };
}

/**
 * The sixteen bytes either side of a `::`, with the gap filled.
 *
 * The count must come out at exactly sixteen: a `::` standing for zero groups,
 * or an address with too many, is malformed rather than something to pad or
 * truncate into shape.
 */
function assembleBytes(text: string): number[] | null {
  const halves = text.split("::");
  if (halves.length > 2) return null;

  const head = parseGroups(halves[0]);
  const rest = halves.length === 2 ? parseGroups(halves[1]) : [];
  if (head === null || rest === null) return null;

  if (halves.length !== 2) {
    return head.length + rest.length === 16 ? [...head, ...rest] : null;
  }

  // A trailing dotted-quad was replaced by a two-group placeholder before this
  // point, so its four bytes are already counted in `rest`. Counting them
  // again shifts everything left, which put the `ffff` of an IPv4-mapped
  // address six bytes early and let `::ffff:127.0.0.1` through as public.
  const fill = 16 - head.length - rest.length;
  if (fill < 0) return null;
  return [...head, ...Array<number>(fill).fill(0), ...rest];
}

/** Expand an IPv6 address to its sixteen bytes, or null when it is malformed. */
function ipv6Bytes(address: string): number[] | null {
  let text = address.trim().toLowerCase();
  if (text.startsWith("[") && text.endsWith("]")) text = text.slice(1, -1);
  const zone = text.indexOf("%");
  if (zone !== -1) text = text.slice(0, zone);

  const embedded = splitEmbeddedIpv4(text);
  if (!embedded) return null;
  const { tail } = embedded;

  const bytes = assembleBytes(embedded.text);
  if (!bytes) return null;

  // The placeholder occupies the last four bytes; put the real address back.
  return tail.length > 0 ? [...bytes.slice(0, 12), ...tail] : bytes;
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

  if (bytes.every(b => b === 0)) return refuse("unspecified");
  if (bytes.slice(0, 15).every(b => b === 0) && bytes[15] === 1) {
    return refuse("loopback");
  }

  const embedded = embeddedIpv4(bytes);
  if (embedded !== null) return judgeIpv4(embedded.join("."));

  if ((bytes[0] & 0xfe) === 0xfc) return refuse("unique-local");
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) {
    return refuse("link-local");
  }
  if (bytes[0] === 0xff) return refuse("multicast");

  return ALLOWED;
}

/**
 * The IPv4 an IPv6 address embeds, as its four octets — or null when it
 * carries none.
 *
 * Every translation prefix asks the same question — "what IPv4 does this
 * actually reach" — so each is judged as the address it carries rather than
 * as an ordinary v6 global that matches no refused prefix. The layouts
 * differ: the mapped and compatible forms and the well-known NAT64 prefix
 * end in the IPv4, the RFC 8215 local-use NAT64 prefix SPLITS it around its
 * u octet (RFC 6052: bits 48-63 and 72-87, so octets at bytes 6-7 and 9-10 —
 * the split keeps the u octet inside the interface-identifier portion an
 * EUI-64 expects), and 6to4 carries its own right after the /16. Answering
 * in octets rather than an offset is what lets the split layout say where
 * each octet actually is.
 */
function embeddedIpv4(bytes: number[]): number[] | null {
  // ::ffff:a.b.c.d — IPv4-mapped.
  if (
    bytes.slice(0, 10).every(b => b === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff
  ) {
    return bytes.slice(12, 16);
  }
  // ::a.b.c.d — IPv4-compatible, deprecated but still routed by some stacks.
  if (bytes.slice(0, 12).every(b => b === 0)) return bytes.slice(12, 16);
  const nat64 = nat64Ipv4(bytes);
  if (nat64 !== null) return nat64;
  // 2002::/16 — 6to4 carries its IPv4 in the next four bytes.
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return bytes.slice(2, 6);
  return null;
}

/**
 * The IPv4 either NAT64 prefix carries, as four octets — or null when the
 * address is neither.
 *
 * Two prefixes, two layouts: the well-known `64:ff9b::/96` ends in the IPv4,
 * and the RFC 8215 local-use `64:ff9b:1::/48` splits it around the u octet
 * (octets at bytes 6-7 and 9-10 per RFC 6052). Reading the split form as one
 * contiguous run judged the private `10.8.5.4` as the public `8.0.5.4` — the
 * exact bypass this judge exists to prevent, since what the prefix carries
 * can be private, loopback, or a metadata service.
 */
function nat64Ipv4(bytes: number[]): number[] | null {
  if (
    bytes[0] === 0x00 &&
    bytes[1] === 0x64 &&
    bytes[2] === 0xff &&
    bytes[3] === 0x9b
  ) {
    if (bytes.slice(4, 12).every(b => b === 0)) return bytes.slice(12, 16);
    if (bytes[4] === 0x00 && bytes[5] === 0x01) {
      return [bytes[6], bytes[7], bytes[9], bytes[10]];
    }
  }
  return null;
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
