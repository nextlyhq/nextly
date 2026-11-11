/**
 * What kind of network address an IP is, for the page check, which connects
 * only to public addresses (and to a loopback or private one only where the
 * site itself is configured there).
 *
 * Parsed here rather than matched as text: an address has many spellings
 * (`::ffff:7f00:1` is `127.0.0.1`), and a pattern over one spelling lets
 * another through.
 *
 * @module received/ip
 */

/** What kind of address an IP is. */
export type IpKind =
  | "public"
  | "loopback"
  | "private"
  | "link-local"
  | "reserved";

/** A range of addresses: its first address and the length of its prefix. */
type Range = readonly [prefix: bigint, length: number, kind: IpKind];

/** An IPv4 address as a number, or undefined where `value` is not one. */
function ipv4(value: string): bigint | undefined {
  const parts = value.split(".");
  if (parts.length !== 4) return undefined;
  let address = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined;
    const octet = Number(part);
    if (octet > 255) return undefined;
    address = (address << 8n) | BigInt(octet);
  }
  return address;
}

/** The 16-bit groups of one side of a `::`, or undefined where malformed. */
function groupsOf(side: string, last: boolean): bigint[] | undefined {
  if (side === "") return [];
  const groups: bigint[] = [];
  const parts = side.split(":");
  for (const [at, part] of parts.entries()) {
    // An IPv4 address may close the address, as two groups.
    if (last && at === parts.length - 1 && part.includes(".")) {
      const four = ipv4(part);
      if (four === undefined) return undefined;
      groups.push(four >> 16n, four & 0xffffn);
      continue;
    }
    if (!/^[0-9a-f]{1,4}$/i.test(part)) return undefined;
    groups.push(BigInt(Number.parseInt(part, 16)));
  }
  return groups;
}

/** An IPv6 address as a number, or undefined where `value` is not one. */
function ipv6(value: string): bigint | undefined {
  // A zone (`fe80::1%en0`) names an interface, not part of the address.
  const address = value.split("%")[0] ?? "";
  if (!address.includes(":")) return undefined;
  const halves = address.split("::");
  if (halves.length > 2) return undefined;
  const head = groupsOf(halves[0] ?? "", halves.length === 1);
  const tail = halves.length === 2 ? groupsOf(halves[1] ?? "", true) : [];
  if (head === undefined || tail === undefined) return undefined;
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return undefined;
  const groups = [...head, ...Array<bigint>(missing).fill(0n), ...tail];
  return groups.reduce((sum, group) => (sum << 16n) | group, 0n);
}

/** `text`, an address like `10.0.0.0`, as the first address of a range. */
function v4(text: string, length: number, kind: IpKind): Range {
  return [ipv4(text) ?? 0n, length, kind];
}

/** `text`, an address like `fc00::`, as the first address of a range. */
function v6(text: string, length: number, kind: IpKind): Range {
  return [ipv6(text) ?? 0n, length, kind];
}

/**
 * The IPv4 ranges that are not public, the narrowest first where they
 * overlap. Shared address space (`100.64.0.0/10`) sits behind a provider's
 * network, so it is private here.
 */
const IPV4: readonly Range[] = [
  v4("0.0.0.0", 8, "reserved"),
  v4("10.0.0.0", 8, "private"),
  v4("100.64.0.0", 10, "private"),
  v4("127.0.0.0", 8, "loopback"),
  v4("169.254.0.0", 16, "link-local"),
  v4("172.16.0.0", 12, "private"),
  v4("192.0.0.0", 24, "reserved"),
  v4("192.0.2.0", 24, "reserved"),
  v4("192.88.99.0", 24, "reserved"),
  v4("192.168.0.0", 16, "private"),
  v4("198.18.0.0", 15, "reserved"),
  v4("198.51.100.0", 24, "reserved"),
  v4("203.0.113.0", 24, "reserved"),
  v4("224.0.0.0", 4, "reserved"),
  v4("240.0.0.0", 4, "reserved"),
];

/**
 * The IPv6 ranges inside global unicast (`2000::/3`) that are not public:
 * documentation, and those that carry another address inside them (Teredo
 * and the rest of `2001::/23`, and 6to4), which could be a private one.
 */
const IPV6_RESERVED: readonly Range[] = [
  v6("2001::", 23, "reserved"),
  v6("2001:db8::", 32, "reserved"),
  v6("2002::", 16, "reserved"),
];

/** Whether `address`, of `bits` bits, is inside `range`. */
function inside(address: bigint, bits: number, range: Range): boolean {
  const [prefix, length] = range;
  const shift = BigInt(bits - length);
  return address >> shift === prefix >> shift;
}

function kindOfV4(address: bigint): IpKind {
  return IPV4.find(range => inside(address, 32, range))?.[2] ?? "public";
}

/**
 * What kind of address `value` is, or undefined where it is not an IP
 * address at all. An IPv4 address written as IPv6 (`::ffff:a.b.c.d`) is the
 * IPv4 address it carries.
 */
export function kindOfIp(value: string): IpKind | undefined {
  const four = ipv4(value);
  if (four !== undefined) return kindOfV4(four);
  const six = ipv6(value);
  if (six === undefined) return undefined;
  if (six >> 32n === 0xffffn) return kindOfV4(six & 0xffffffffn);
  if (six === 1n) return "loopback";
  if (inside(six, 128, v6("fc00::", 7, "private"))) return "private";
  if (inside(six, 128, v6("fe80::", 10, "link-local"))) return "link-local";
  // Only global unicast can be public; everything outside it is reserved
  // (the unspecified address, multicast, NAT64 and the rest).
  if (!inside(six, 128, v6("2000::", 3, "public"))) return "reserved";
  return IPV6_RESERVED.some(range => inside(six, 128, range))
    ? "reserved"
    : "public";
}
