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
  | "documentation"
  | "multicast"
  | "broadcast"
  | "reserved"
  | "unique-local"
  | "site-local"
  | "nat64-local-use"
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
  // TEST-NET-1, -2 and -3 (RFC 5737). Never assigned on the public internet,
  // so a name that resolves into one is pointing somewhere a network has
  // chosen to route privately.
  {
    reason: "documentation",
    matches: ([a, b, c]) => a === 192 && b === 0 && c === 2,
  },
  {
    reason: "documentation",
    matches: ([a, b, c]) => a === 198 && b === 51 && c === 100,
  },
  {
    reason: "documentation",
    matches: ([a, b, c]) => a === 203 && b === 0 && c === 113,
  },
  // The retired 6to4 relay anycast range (RFC 7526), which operators may still
  // route to a relay of their own.
  {
    reason: "reserved",
    matches: ([a, b, c]) => a === 192 && b === 88 && c === 99,
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

  const hit = REFUSED_IPV6.find(rule => rule.matches(bytes));
  return hit ? refuse(hit.reason) : ALLOWED;
}

/** The IPv6 prefixes a plugin may not reach, as data like the IPv4 table. */
const REFUSED_IPV6: ReadonlyArray<{
  reason: AddressRefusal;
  matches: (bytes: number[]) => boolean;
}> = [
  { reason: "unique-local", matches: ([a]) => (a & 0xfe) === 0xfc },
  {
    reason: "link-local",
    matches: ([a, b]) => a === 0xfe && (b & 0xc0) === 0x80,
  },
  // fec0::/10 — site-local, deprecated since 2004 but still routed on
  // networks that predate the deprecation. Internal-only by design, like the
  // unique-local range above it, and falling through as public let a
  // declared host reach internal v6 services through the vetted address.
  {
    reason: "site-local",
    matches: ([a, b]) => a === 0xfe && (b & 0xc0) === 0xc0,
  },
  { reason: "multicast", matches: ([a]) => a === 0xff },
  // 64:ff9b:1::/48 — RFC 8215 local-use NAT64, marked not globally reachable
  // by IANA. Refused whatever it carries: an operator may run it with any
  // RFC 6052 prefix length, so the IPv4 inside cannot be located reliably.
  {
    reason: "nat64-local-use",
    matches: ([a, b, c, d, e, f]) =>
      a === 0x00 &&
      b === 0x64 &&
      c === 0xff &&
      d === 0x9b &&
      e === 0x00 &&
      f === 0x01,
  },
  // 2001:db8::/32 (RFC 3849) and 3fff::/20 (RFC 9637), the IPv6 counterparts
  // of the IPv4 TEST-NETs.
  {
    reason: "documentation",
    matches: ([a, b, c, d]) =>
      a === 0x20 && b === 0x01 && c === 0x0d && d === 0xb8,
  },
  {
    reason: "documentation",
    matches: ([a, b, c]) => a === 0x3f && b === 0xff && (c & 0xf0) === 0,
  },
  // 2001:2::/48 — the IPv6 benchmarking range (RFC 5180), like 198.18/15.
  // Before the block below, which contains it, so it is named for itself.
  {
    reason: "benchmark",
    matches: ([a, b, c, d, e, f]) =>
      a === 0x20 && b === 0x01 && c === 0 && d === 0x02 && e === 0 && f === 0,
  },
  // 2001::/23 — IETF protocol assignments (RFC 2928), Teredo among them.
  // Not globally reachable as a block; the few anycast services inside it
  // are nothing a plugin's declared host resolves to.
  {
    reason: "reserved",
    matches: ([a, b, c]) => a === 0x20 && b === 0x01 && (c & 0xfe) === 0,
  },
  // 100::/64 discard-only (RFC 6666) and 100:0:0:1::/64 dummy (RFC 9780):
  // traffic to either is meant to go nowhere.
  {
    reason: "reserved",
    matches: b =>
      b[0] === 0x01 && b.slice(1, 7).every(x => x === 0) && (b[7] & 0xfe) === 0,
  },
  // 5f00::/16 — segment-routing SIDs (RFC 9602), internal to the network
  // that assigns them.
  { reason: "reserved", matches: ([a, b]) => a === 0x5f && b === 0x00 },
];

/**
 * The IPv4 an IPv6 address embeds, as its four octets — or null when it
 * carries none.
 *
 * Every translation prefix asks the same question — "what IPv4 does this
 * actually reach" — so each is judged as the address it carries rather than
 * as an ordinary v6 global that matches no refused prefix. The mapped and
 * compatible forms and the well-known NAT64 prefix end in the IPv4, and 6to4
 * carries its own right after the /16. The RFC 8215 local-use NAT64 prefix is
 * not decoded here: it is refused whole (`nat64-local-use`), since any
 * network can deploy it and what it translates to is that network's choice.
 */
function embeddedIpv4(bytes: number[]): number[] | null {
  const ffff = ffffTranslationIpv4(bytes);
  if (ffff !== null) return ffff;
  // ::a.b.c.d — IPv4-compatible, deprecated but still routed by some stacks.
  if (bytes.slice(0, 12).every(b => b === 0)) return bytes.slice(12, 16);
  const nat64 = nat64Ipv4(bytes);
  if (nat64 !== null) return nat64;
  // 2002::/16 — 6to4 carries its IPv4 in the next four bytes.
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return bytes.slice(2, 6);
  return null;
}

/**
 * The IPv4 either `::ffff:` translation prefix carries, or null for neither.
 *
 * Two spellings, one marker family: the IPv4-MAPPED form `::ffff:a.b.c.d`
 * puts the ffff at bytes 10-11, and the IPv4-TRANSLATED form
 * `::ffff:0:a.b.c.d` of RFC 6145 moves it to bytes 8-9 behind a zero pair.
 * Both deliver the embedded address to whoever connects — a translator on
 * either prefix reaches whatever the IPv4 is, private or loopback included —
 * and recognizing only the mapped spelling let the translated one through as
 * an ordinary global address.
 */
function ffffTranslationIpv4(bytes: number[]): number[] | null {
  if (
    bytes.slice(0, 10).every(b => b === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff
  ) {
    return bytes.slice(12, 16);
  }
  if (
    bytes.slice(0, 8).every(b => b === 0) &&
    bytes[8] === 0xff &&
    bytes[9] === 0xff &&
    bytes[10] === 0x00 &&
    bytes[11] === 0x00
  ) {
    return bytes.slice(12, 16);
  }
  return null;
}

/**
 * The IPv4 the well-known NAT64 prefix `64:ff9b::/96` carries, as four octets
 * — or null when the address is not under it.
 *
 * Only the well-known prefix, whose layout is fixed. The RFC 8215 local-use
 * `64:ff9b:1::/48` may be operated with any RFC 6052 prefix length, so no
 * single decoding reads it correctly — one layout judged `10.0.0.1` behind a
 * /96 as some unrelated public address. It is refused as a whole instead (see
 * `REFUSED_IPV6`), as IANA marks it not globally reachable.
 */
function nat64Ipv4(bytes: number[]): number[] | null {
  if (
    bytes[0] === 0x00 &&
    bytes[1] === 0x64 &&
    bytes[2] === 0xff &&
    bytes[3] === 0x9b &&
    bytes.slice(4, 12).every(b => b === 0)
  ) {
    return bytes.slice(12, 16);
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

/**
 * An outbound allowlist entry split into its host pattern and its port.
 *
 * `api.example.com` names the host on its scheme's default port;
 * `api.example.com:8443` names that port. A port is a separate service on the
 * same machine, and an entry naming only the host granted every one of them
 * (`https://api.example.com:22/`), which nobody reading the manifest would
 * have understood it to say.
 */
export function outboundEntry(entry: string): {
  pattern: string;
  port?: number;
} {
  const match = /^(.*):(\d{1,5})$/.exec(entry);
  if (!match) return { pattern: entry };
  return { pattern: match[1], port: Number(match[2]) };
}

/** The default port of a URL's scheme. */
function schemeDefaultPort(url: URL): number {
  return url.protocol === "http:" ? 80 : 443;
}

/** The port a URL connects to, its scheme's default when it names none. */
function effectivePort(url: URL): number {
  return url.port === "" ? schemeDefaultPort(url) : Number(url.port);
}

/**
 * Whether a URL's host AND port are on the allowlist.
 *
 * `anyPort` is for the development-only loopback exception: a fake provider
 * in a plugin's own tests listens on whatever port it was given, and its
 * manifest cannot know that number in advance.
 */
export function destinationAllowed(
  url: URL,
  allowlist: readonly string[],
  anyPort: boolean
): boolean {
  const port = effectivePort(url);
  return allowlist.some(entry => {
    const { pattern, port: declared } = outboundEntry(entry);
    if (!hostMatches(url.hostname, pattern)) return false;
    if (anyPort) return true;
    return port === (declared ?? schemeDefaultPort(url));
  });
}
