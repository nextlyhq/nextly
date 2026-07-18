/**
 * SSRF-safe external URL validation + fetch.
 *
 * Closes the SSRF gap left by the previous webhook URL validator
 * (protocol-only) and the email-attachment fetcher (no validation).
 * Either let an attacker who controls a `url` field probe internal
 * services or exfiltrate cloud-metadata IAM credentials
 * (`http://169.254.169.254/...`).
 *
 * `validateExternalUrl(url, opts)`:
 *   1. Parse URL; reject non-allowed protocols.
 *   2. Reject hard-coded cloud-metadata hostnames before DNS.
 *   3. DNS-resolve the hostname (`all: true`). Reject if ANY returned
 *      IP is private/loopback/link-local/CGNAT/multicast/cloud-metadata.
 *      A single bad IP poisons the lookup — attacker-controlled DNS
 *      could rotate which IP is returned per call.
 *   4. Return the validated URL + the first resolved IP so the fetch can
 *      dial that exact address (see `safeFetch`).
 *
 * `safeFetch(url, opts?)`:
 *   Validate, then fetch the response with the validated IP pinned at the
 *   socket. The validation and the connection resolve the hostname only
 *   once between them, so a second DNS answer at connect time cannot
 *   redirect the request to a private address (DNS rebinding). Uses
 *   `node:http`/`node:https` `request({ lookup })` — `undici` is not a
 *   dependency of this lean package, and the built-in modules pin the
 *   address without one. Redirects are not followed (a 3xx is returned as
 *   is), the response body is size-capped, and the whole request is bounded
 *   by a deadline. Node-runtime only.
 *
 * Implementation note: this module avoids module-level *runtime* Node
 * imports so downstream packages that bundle for the browser
 * (e.g. `@nextlyhq/admin`) don't fail at build time. `node:dns/promises`
 * and `node:http`/`node:https` are loaded lazily inside the functions that
 * need them; the `node:http`/`node:net` type-only imports are erased at
 * compile time.
 *
 * @module utils/validate-external-url
 */

import type { IncomingMessage } from "node:http";
import type { LookupFunction } from "node:net";

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
      family === 4
        ? isPublicIpv4(address, allow)
        : isPublicIpv6(address, allow);
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

/** Default response body cap: reject anything larger before buffering it all. */
const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10 MiB
/** Default overall deadline covering DNS + connect + TLS + response. */
const DEFAULT_TIMEOUT_MS = 30_000;

export interface SafeFetchOptions extends ValidateExternalUrlOptions {
  /** HTTP method. Defaults to GET. */
  method?: string;
  /** Request headers (plain object, entries array, or `Headers`). */
  headers?: HeadersInit;
  /** Request body. Only string / binary bodies are supported. */
  body?: string | Uint8Array;
  /** Abort signal; an external timeout surfaces as a standard `AbortError`. */
  signal?: AbortSignal | null;
  /** Reject once the response body exceeds this many bytes. Default 10 MiB. */
  maxResponseBytes?: number;
  /** Overall deadline in ms covering connect + response. Default 30s. */
  timeoutMs?: number;
}

/**
 * Raised for fetch-phase failures that are NOT SSRF rejections: an over-large
 * response body or the overall deadline elapsing. Kept distinct from
 * `ExternalUrlError` so a caller can tell "URL refused for safety" apart from
 * "the request itself failed" (which would otherwise be mislabeled as an SSRF
 * rejection).
 */
export class SafeFetchError extends Error {
  constructor(
    message: string,
    public readonly url: string,
    /** Discriminates the failure so callers branch without string-matching. */
    public readonly reason: "response-too-large" | "timeout"
  ) {
    super(message);
    this.name = "SafeFetchError";
  }
}

/**
 * Build a `dns.lookup`-compatible function that ignores the hostname and
 * always resolves to `ip`/`family`. Handing this to `http(s).request` forces
 * the socket to dial the exact address `validateExternalUrl` already vetted,
 * closing the DNS-rebinding window where a second resolution at connect time
 * could return a private IP. Not re-exported from the package barrel; exported
 * here so the rebinding invariant can be unit-tested directly.
 */
export function createPinnedLookup(ip: string, family: 4 | 6): LookupFunction {
  return (_hostname, options, callback) => {
    // Node calls lookup with an options object. `all: true` expects the array
    // form of the callback; otherwise the (address, family) form. The
    // hostname argument is deliberately unused: the whole point is to bypass
    // a fresh resolution and pin the vetted address.
    if (options && options.all) {
      callback(null, [{ address: ip, family }]);
    } else {
      callback(null, ip, family);
    }
  };
}

/**
 * Validate `rawUrl` then fetch it with the validated IP pinned at the socket.
 * The convenience wrapper for the common case (webhook delivery, email
 * attachment fetch). Node-runtime only.
 *
 * DNS is resolved once by `validateExternalUrl`; `createPinnedLookup` forces
 * the connection to that same address, so an attacker's DNS cannot rebind the
 * request to a private host between validation and connect. Redirects are not
 * followed, the body is capped at `maxResponseBytes`, and the request is
 * bounded by `timeoutMs`.
 */
export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions = {}
): Promise<Response> {
  const {
    allowLocalhost,
    allowedProtocols,
    method,
    headers,
    body,
    signal,
    maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  // One controller bounds the WHOLE operation — DNS validation and the request
  // alike — so a stalled lookup can't outlive the advertised deadline, and a
  // caller abort is honored during validation too. Both the deadline timer and
  // the caller's signal feed it.
  const controller = new AbortController();
  const forwardAbort = (): void => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", forwardAbort, { once: true });
  }
  const timer = setTimeout(
    () =>
      controller.abort(
        new SafeFetchError(`Request exceeded ${timeoutMs}ms`, rawUrl, "timeout")
      ),
    timeoutMs
  );

  try {
    const validated = await abortable(
      validateExternalUrl(rawUrl, { allowLocalhost, allowedProtocols }),
      controller.signal
    );
    return await pinnedFetch(validated, {
      method,
      headers,
      body,
      signal: controller.signal,
      maxResponseBytes,
    });
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", forwardAbort);
  }
}

/**
 * The signal's abort reason as an `Error`. Our own aborts carry a
 * `SafeFetchError` (timeout); a caller's `AbortController.abort()` carries a
 * DOMException `AbortError`; anything else (a non-Error reason) is surfaced as
 * a standard `AbortError` so downstream `name === "AbortError"` checks hold.
 */
function abortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  if (reason instanceof Error) return reason;
  return new DOMException("The operation was aborted", "AbortError");
}

/**
 * Resolve `promise`, but reject with the signal's reason if it aborts first.
 * Lets a phase that runs before the request (DNS validation) share the overall
 * deadline and caller cancellation.
 */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError(signal));
  let onAbort!: () => void;
  // Race the work against the abort. `promise`'s own rejection propagates
  // natively through the race; only the abort path rejects explicitly (with a
  // typed Error), so the promise's arbitrary reason is never re-wrapped.
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = (): void => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  return Promise.race([promise, aborted]).finally(() =>
    signal.removeEventListener("abort", onAbort)
  );
}

interface PinnedFetchInit {
  method?: string;
  headers?: HeadersInit;
  body?: string | Uint8Array;
  /** The combined deadline/caller signal built by `safeFetch`. */
  signal: AbortSignal;
  maxResponseBytes: number;
}

/**
 * Issue the request over `node:http`/`node:https` with the validated IP pinned
 * via a custom `lookup`, then adapt the Node response into a WHATWG `Response`.
 * `agent: false` forces a fresh socket per call so no pooled connection can
 * reuse a differently-resolved address. The overall deadline is enforced by the
 * caller through `init.signal`, so there is no separate timer here.
 */
async function pinnedFetch(
  validated: ValidatedUrl,
  init: PinnedFetchInit
): Promise<Response> {
  const { url, pinnedIp, family } = validated;
  // Lazy, literal-specifier imports keep the module import-safe for bundlers
  // targeting the browser (some packages re-export this util).
  const httpMod =
    url.protocol === "https:"
      ? await import("node:https")
      : await import("node:http");

  const lookup = createPinnedLookup(pinnedIp, family);

  const outHeaders = toOutgoingHeaders(init.headers);
  // Send fixed-size bodies with an explicit content-length rather than the
  // chunked transfer-encoding Node falls back to, which some webhook receivers
  // (and strict HTTP/1.0 servers) reject.
  if (init.body != null && !("content-length" in outHeaders)) {
    outHeaders["content-length"] = String(
      typeof init.body === "string"
        ? Buffer.byteLength(init.body)
        : init.body.byteLength
    );
  }

  return new Promise<Response>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      fn();
    };
    // Prefer the abort reason (our timeout SafeFetchError, or the caller's
    // AbortError) over Node's generic socket error when the signal fired.
    const failure = (err: Error): Error =>
      init.signal.aborted ? abortError(init.signal) : err;

    const req = httpMod.request(
      url,
      {
        method: init.method ?? "GET",
        headers: outHeaders,
        lookup,
        // Fresh socket per request so a pooled connection can't reuse a
        // differently-resolved address, and so the pinned lookup always runs.
        agent: false,
        // The combined deadline/caller signal aborts the request in flight.
        signal: init.signal,
      },
      res => {
        const chunks: Buffer[] = [];
        let received = 0;
        res.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > init.maxResponseBytes) {
            res.destroy();
            req.destroy();
            settle(() =>
              reject(
                new SafeFetchError(
                  `Response body exceeded ${init.maxResponseBytes} bytes`,
                  url.href,
                  "response-too-large"
                )
              )
            );
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          // toWhatwgResponse is total (skips headers the WHATWG layer rejects,
          // clamps the status), so building the Response cannot throw here.
          settle(() => resolve(toWhatwgResponse(res, Buffer.concat(chunks))));
        });
        res.on("error", err => settle(() => reject(failure(err))));
      }
    );

    req.on("error", err => settle(() => reject(failure(err))));

    // A pre-aborted signal destroys the request synchronously; the `error`
    // handler above then rejects. Otherwise send the body and finish.
    if (!req.destroyed) {
      if (init.body != null) req.write(init.body);
      req.end();
    }
  });
}

/** Normalize a `HeadersInit` into Node's outgoing-header shape. */
function toOutgoingHeaders(
  headers?: HeadersInit
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  if (!headers) return out;
  // Repeated keys must accumulate rather than clobber: only the entries-array
  // form can carry duplicates (a plain object can't, and `Headers` already
  // merges same-name values on iteration).
  const add = (key: string, value: string): void => {
    const existing = out[key];
    out[key] =
      existing === undefined ? value : ([] as string[]).concat(existing, value);
  };
  if (headers instanceof Headers) {
    headers.forEach((value, key) => add(key, value));
  } else if (Array.isArray(headers)) {
    for (const [key, value] of headers) add(key, value);
  } else {
    for (const [key, value] of Object.entries(headers)) add(key, value);
  }
  return out;
}

/**
 * Adapt a Node `IncomingMessage` + buffered body into a WHATWG `Response`.
 * Total by construction: a header the WHATWG layer rejects is skipped and the
 * status is clamped to a constructible range, so this never throws (a throw
 * would otherwise escape the `end` handler as an uncaught error).
 */
function toWhatwgResponse(res: IncomingMessage, body: Buffer): Response {
  const headers = new Headers();
  for (const [key, value] of Object.entries(res.headers)) {
    if (value == null) continue;
    // set-cookie and other repeated headers arrive as arrays.
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) {
      try {
        headers.append(key, v);
      } catch {
        // A header Node accepted but the stricter WHATWG layer rejects is
        // dropped rather than failing the whole response.
      }
    }
  }
  // Received responses are always >= 200; clamp defensively so the Response
  // constructor (valid range 200-599) can never throw on a malformed status.
  const raw = res.statusCode ?? 502;
  const status = raw >= 200 && raw <= 599 ? raw : 502;
  // Null-body statuses cannot carry an entity body in the WHATWG constructor.
  const nullBody = status === 204 || status === 205 || status === 304;
  // Bulk-copy into a fresh ArrayBuffer-backed Uint8Array: this satisfies the
  // DOM BodyInit type (Node's Buffer generic does not) without the O(n)
  // element-by-element copy that `Uint8Array.from` performs.
  const bytes = new Uint8Array(body.byteLength);
  bytes.set(body);
  return new Response(nullBody ? null : bytes, {
    status,
    statusText: res.statusMessage ?? "",
    headers,
  });
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
  return (intIp & mask) >>> 0 === (intCidr & mask) >>> 0;
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

/**
 * Extract the embedded IPv4 of an IPv4-mapped IPv6 address, or null. Handles
 * both the dotted form (`::ffff:1.2.3.4`) and the hex form (`::ffff:7f00:1`)
 * that `URL.hostname` normalizes the dotted literal to — the latter would
 * otherwise skip the IPv4 denylist and pin, e.g., loopback as public.
 */
function mappedIpv4(lower: string): string | null {
  const dotted = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) return dotted[1];
  const hex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join(".");
  }
  return null;
}

function isPublicIpv6(addr: string, allowLoopback: boolean): boolean {
  const lower = addr.toLowerCase();
  if (allowLoopback && lower === "::1") return true;

  // IPv4-mapped IPv6 — defer to IPv4 rules (both dotted and hex-normalized).
  const mapped = mappedIpv4(lower);
  if (mapped) {
    return isPublicIpv4(mapped, allowLoopback);
  }

  // Hard rejects on exact / prefix matches
  if (lower === "::" || lower === "::1") return false;

  // Take first hextet for prefix-style checks
  const firstHextet = lower.split(":")[0] || "";
  // ULA fc00::/7 — first hextet starts with fc or fd
  if (firstHextet.startsWith("fc") || firstHextet.startsWith("fd"))
    return false;
  // Link-local fe80::/10 — first hextet fe80..febf
  if (firstHextet.startsWith("fe8") || firstHextet.startsWith("fe9"))
    return false;
  if (firstHextet.startsWith("fea") || firstHextet.startsWith("feb"))
    return false;
  // Multicast ff00::/8
  if (firstHextet.startsWith("ff")) return false;

  return true;
}
