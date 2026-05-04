/**
 * SSRF-safe external URL validation + fetch.
 *
 * closes both. The previous webhook
 * URL validator only checked protocol; the email-attachment fetcher
 * validated nothing. Either let an attacker who controls a `url` field
 * probe internal services or exfiltrate cloud-metadata IAM credentials
 * (`http://169.254.169.254/...`).
 *
 * `validateExternalUrl(url, opts)`:
 *   1. Parse URL; reject non-allowed protocols.
 *   2. Reject hard-coded cloud-metadata hostnames before DNS.
 *   3. DNS-resolve the hostname (`all: true`). Reject if ANY returned
 *      IP is private/loopback/link-local/CGNAT/multicast/cloud-metadata.
 *      A single bad IP poisons the lookup — attacker-controlled DNS
 *      could rotate which IP is returned per call.
 *   4. Return the validated URL + first resolved IP (the caller can use
 *      it as a hint; full DNS-rebinding defense via dispatcher pinning
 *      is documented as a follow-up).
 *
 * `safeFetch(url, init?, opts?)`:
 *   Validate → fetch. Convenience wrapper for the common case.
 *
 * Implementation note: this module avoids module-level Node imports
 * so downstream packages that bundle for the browser
 * (e.g. `@revnixhq/admin`) don't fail at build time. `node:dns/promises`
 * is loaded lazily inside the validation function.
 *
 * Known gap: full DNS-rebinding defense requires pinning the resolved
 * IP on the actual fetch dispatcher (undici Agent + custom connect).
 * Not implemented in v1 — the validation itself closes the primary
 * attack surface (URL pointing directly at private IP). Tracked for
 * follow-up.
 *
 * @module utils/validate-external-url
 */

const IPV4_RE =
  /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

/**
 * IPv4 CIDR ranges that must NEVER be the destination of an outbound
 * fetch sourced from a user-controllable URL. Listed roughly by RFC.
 */
const PRIVATE_IPV4_CIDRS: readonly string[] = [
  "0.0.0.0/8", // RFC1122 "this network" / wildcard
  "10.0.0.0/8", // RFC1918
  "100.64.0.0/10", // RFC6598 CGNAT
  "127.0.0.0/8", // RFC1122 loopback
  "169.254.0.0/16", // RFC3927 link-local + AWS/GCP metadata
  "172.16.0.0/12", // RFC1918
  "192.0.0.0/24", // RFC6890 IETF protocol assignments
  "192.0.2.0/24", // RFC5737 documentation
  "192.168.0.0/16", // RFC1918
  "198.18.0.0/15", // RFC2544 benchmarking
  "198.51.100.0/24", // RFC5737 documentation
  "203.0.113.0/24", // RFC5737 documentation
  "224.0.0.0/4", // RFC5771 multicast
  "240.0.0.0/4", // RFC1112 reserved
];

/**
 * Cloud-metadata hostnames. These often resolve to private IPs and the
 * private-IP block catches them, but we reject by hostname first so the
 * error message is clear.
 */
const CLOUD_METADATA_HOSTS: ReadonlySet<string> = new Set([
  "metadata.google.internal",
  "metadata.googleapis.com",
  "metadata", // GCP short form
]);

export interface ValidateExternalUrlOptions {
  /**
   * When true, allow `localhost` / `127.0.0.1` / `::1` and HTTP
   * protocol (for tests, dev playgrounds). Default false.
   */
  allowLocalhost?: boolean;
  /**
   * Allowed URL protocols. Defaults to `["https:"]` — webhooks, email
   * attachments, and similar should never speak plain HTTP.
   */
  allowedProtocols?: readonly string[];
}

export interface ValidatedUrl {
  /** The parsed URL (validated). */
  url: URL;
  /** The first IP returned by DNS — usable as an IP-pin hint. */
  pinnedIp: string;
  /** IP family of `pinnedIp`: 4 or 6. */
  family: 4 | 6;
}

export class ExternalUrlError extends Error {
  constructor(
    message: string,
    public readonly url: string
  ) {
    super(message);
    this.name = "ExternalUrlError";
  }
}

/** Validate a URL for outbound fetch. Throws `ExternalUrlError` on rejection. */
export async function validateExternalUrl(
  rawUrl: string,
  options: ValidateExternalUrlOptions = {}
): Promise<ValidatedUrl> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ExternalUrlError("Invalid URL", rawUrl);
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const isLocalhostHostname =
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";

  const baseProtocols = options.allowedProtocols ?? ["https:"];
  const protocols =
    options.allowLocalhost && isLocalhostHostname
      ? [...baseProtocols, "http:"]
      : baseProtocols;

  if (!protocols.includes(parsed.protocol)) {
    throw new ExternalUrlError(
      `Protocol ${parsed.protocol} not allowed (allowed: ${protocols.join(", ")})`,
      rawUrl
    );
  }

  if (CLOUD_METADATA_HOSTS.has(hostname)) {
    throw new ExternalUrlError(
      `Cloud-metadata hostname rejected: ${parsed.hostname}`,
      rawUrl
    );
  }

  // If the hostname is itself a literal IP, validate it directly without DNS.
  if (IPV4_RE.test(hostname)) {
    if (
      !isPublicIpv4(
        hostname,
        options.allowLocalhost === true && hostname === "127.0.0.1"
      )
    ) {
      throw new ExternalUrlError(
        `Resolved to non-public IP: ${hostname}`,
        rawUrl
      );
    }
    return { url: parsed, pinnedIp: hostname, family: 4 };
  }
  if (hostname.includes(":")) {
    if (
      !isPublicIpv6(
        hostname,
        options.allowLocalhost === true && hostname === "::1"
      )
    ) {
      throw new ExternalUrlError(
        `Resolved to non-public IP: ${hostname}`,
        rawUrl
      );
    }
    return { url: parsed, pinnedIp: hostname, family: 6 };
  }

  // DNS lookup. Lazy-import to keep module browser-safe.
  const { lookup } = await import("node:dns/promises");
  let addresses: { address: string; family: number }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch (err) {
    throw new ExternalUrlError(
      `DNS lookup failed: ${(err as Error).message}`,
      rawUrl
    );
  }
  if (addresses.length === 0) {
    throw new ExternalUrlError("No IPs returned for host", rawUrl);
  }

  // A single bad address rejects the whole URL. Attacker-controlled DNS
  // could rotate; we don't try to be clever about ordering.
  for (const { address, family } of addresses) {
    const allow =
      options.allowLocalhost === true && isLocalhostHostname && family === 4;
    const ok =
      family === 4 ? isPublicIpv4(address, allow) : isPublicIpv6(address, allow);
    if (!ok) {
      throw new ExternalUrlError(
        `Resolved to non-public IP: ${address}`,
        rawUrl
      );
    }
  }

  const first = addresses[0];
  return {
    url: parsed,
    pinnedIp: first.address,
    family: first.family === 6 ? 6 : 4,
  };
}

export interface SafeFetchOptions
  extends ValidateExternalUrlOptions,
    Omit<RequestInit, never> {}

/**
 * Validate `rawUrl` then `fetch()` it. Convenience wrapper for the
 * common case (webhook delivery, email attachment fetch).
 *
 * NOTE: this does NOT pin the resolved IP on the actual connection.
 * If full DNS-rebinding defense is required, the caller should
 * implement a dispatcher with a custom `connect` that forces the
 * `pinnedIp` returned by `validateExternalUrl()`.
 */
export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions = {}
): Promise<Response> {
  const { allowLocalhost, allowedProtocols, ...init } = options;
  await validateExternalUrl(rawUrl, { allowLocalhost, allowedProtocols });
  return fetch(rawUrl, init as RequestInit);
}

// ---------- IP classification (regex-based, browser-safe) ----------

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

function isIpv4InCidr(intIp: number, cidr: string): boolean {
  const [addr, prefixRaw] = cidr.split("/");
  const intCidr = ipv4ToInt(addr);
  if (intCidr === null) return false;
  const prefix = Number(prefixRaw);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  const mask = prefix === 0 ? 0 : (-1 >>> (32 - prefix)) << (32 - prefix);
  return ((intIp & mask) >>> 0) === ((intCidr & mask) >>> 0);
}

function isPublicIpv4(addr: string, allowLoopback: boolean): boolean {
  const intIp = ipv4ToInt(addr);
  if (intIp === null) return false;
  if (allowLoopback && addr === "127.0.0.1") return true;
  for (const cidr of PRIVATE_IPV4_CIDRS) {
    if (isIpv4InCidr(intIp, cidr)) return false;
  }
  return true;
}

function isPublicIpv6(addr: string, allowLoopback: boolean): boolean {
  const lower = addr.toLowerCase();
  if (allowLoopback && lower === "::1") return true;

  // IPv4-mapped IPv6 (::ffff:1.2.3.4) — defer to IPv4 rules
  const v4mapped = lower.match(/^::ffff:([0-9.]+)$/);
  if (v4mapped) {
    return isPublicIpv4(v4mapped[1], allowLoopback);
  }

  // Hard rejects on exact / prefix matches
  if (lower === "::" || lower === "::1") return false;

  // Take first hextet for prefix-style checks
  const firstHextet = lower.split(":")[0] || "";
  // ULA fc00::/7 — first hextet starts with fc or fd
  if (firstHextet.startsWith("fc") || firstHextet.startsWith("fd")) return false;
  // Link-local fe80::/10 — first hextet fe80..febf
  if (firstHextet.startsWith("fe8") || firstHextet.startsWith("fe9")) return false;
  if (firstHextet.startsWith("fea") || firstHextet.startsWith("feb")) return false;
  // Multicast ff00::/8
  if (firstHextet.startsWith("ff")) return false;

  return true;
}
