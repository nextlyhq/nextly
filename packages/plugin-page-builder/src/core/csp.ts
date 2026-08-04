/**
 * Building the Content-Security-Policy fetch directives from the origin policy.
 *
 * The parser policy refuses a URL it can read. A CSP refuses a REQUEST, which
 * is a different guarantee and a stronger one here: it covers the surfaces a
 * parser cannot reach — a block registered outside this package, and a
 * cross-origin `<base href>` that re-points every relative URL on the page —
 * because it constrains the fetch rather than the text that describes it.
 *
 * Generated from the same `remotePatterns` the parser uses, so the two cannot
 * disagree about which hosts are allowed. Declaring them twice is how they
 * would.
 *
 * ## Nextly builds this; the HOST sends it
 *
 * Nothing here injects a policy. A page built with this plugin is one region of
 * a host's document, and a policy is document-wide however it arrives — a
 * `<meta http-equiv>` constrains the whole page, and multiple policies
 * INTERSECT, so an injected one can only tighten what the host already sends.
 * Emitting a policy from a component would therefore break the host's own
 * images and embeds elsewhere on a page this package does not own.
 *
 * The host puts the value in its `middleware.ts`, its `next.config` `headers()`
 * or its CDN, merged with whatever it already sends. It owns the response, so
 * it owns the header.
 *
 * ## Fetch directives only
 *
 * No `script-src`, and deliberately. The canonical Next.js recipe uses a
 * per-request nonce, which forces dynamic rendering on every page and would
 * defeat tag-based ISR. A nonce governs scripts; the channel this closes is
 * where a RESOURCE comes from, and a host allowlist is a static string that
 * works unchanged under static generation, ISR and dynamic rendering alike.
 * Scripts remain the host application's business.
 *
 * @module core/csp
 */

import type { RemotePattern, RemotePatternInput } from "./url-policy";

/** The directives this generates, in the order they are emitted. */
export const CSP_FETCH_DIRECTIVES = [
  "img-src",
  "media-src",
  "frame-src",
  "font-src",
] as const;

export type CspFetchDirective = (typeof CSP_FETCH_DIRECTIVES)[number];

export interface CspOptions {
  /**
   * Allow `data:` URIs for images.
   *
   * On by default because inline SVG placeholders and tiny blur-up previews are
   * ordinary, and a `data:` URI carries its bytes with it — it names no host,
   * so it cannot be the conditional request this policy exists to stop.
   */
  allowDataImages?: boolean;
  /**
   * Allow `blob:` URIs for images and media.
   *
   * Off by default. A blob is same-origin by construction, but it is created by
   * script, so allowing it widens what a compromised script can display rather
   * than what an author can declare.
   */
  allowBlobMedia?: boolean;
}

/** A pattern's origin as a CSP source expression, or `undefined` if unusable. */
function sourceExpression(input: RemotePatternInput): string | undefined {
  let pattern: RemotePattern;
  if (input instanceof URL) {
    // The origin policy refuses anything that is not http(s), so a `URL`
    // carrying another scheme allows nothing there. Emitting its host — which
    // dropping the scheme would do — would let the CSP permit a host the
    // parser refuses, which is the one direction these must never differ in.
    if (input.protocol !== "http:" && input.protocol !== "https:")
      return undefined;
    pattern = {
      // A `URL` writes `https:` where a pattern writes `https`.
      protocol: input.protocol.slice(0, -1) as "http" | "https",
      hostname: input.hostname,
      ...(input.port ? { port: input.port } : {}),
    };
  } else {
    pattern = input;
  }

  const host = pattern.hostname.trim();
  if (host === "") return undefined;

  // CSP host sources accept ONE leading `*.` and nothing else, while
  // `remotePatterns` hostnames are picomatch globs. A glob this cannot express
  // is REFUSED rather than widened: widening `cdn-*.com` to `*.com` would allow
  // every registrable domain under a public suffix, which defeats the backstop
  // it is meant to be. Identifying a public suffix needs a list this package has
  // no business shipping, so the safe reading is that any host needing a
  // wildcard beyond the one CSP grammar allows cannot be expressed here.
  if (!isExpressibleHost(host)) return undefined;

  // A port reaches the header as text, so anything that is not digits could
  // close the source and open another directive — `443; script-src *` is a
  // policy of the caller's choosing. The type says `string`, so this checks
  // rather than trusts.
  const port = pattern.port?.trim() ?? "";
  if (port !== "" && !/^[0-9]+$/.test(port)) return undefined;

  const scheme = pattern.protocol ? `${pattern.protocol}://` : "";
  return `${scheme}${host}${port === "" ? "" : `:${port}`}`;
}

/**
 * Whether a hostname is something CSP can express exactly.
 *
 * A literal host, or one leading `*.` followed by literal labels — the whole of
 * the CSP host-source grammar. Everything else is a picomatch glob with no CSP
 * equivalent, and there is no safe approximation: the nearest expressible
 * ancestor of `cdn-*.co.uk` is `*.co.uk`, which allows every site under a public
 * suffix. Refusing is the direction that keeps the CSP a backstop; the host adds
 * an explicit source if it needs one, and {@link unexpressibleHosts} names them.
 */
function isExpressibleHost(host: string): boolean {
  const body = host.startsWith("*.") ? host.slice(2) : host;
  return body !== "" && /^[A-Za-z0-9.-]+$/.test(body);
}

/**
 * The pattern hostnames this cannot turn into a CSP source.
 *
 * Reported rather than silently dropped, because a refused host is media the
 * page is configured to show and the CSP would block — the host needs to know
 * to write that source itself.
 */
export function unexpressibleHosts(
  remotePatterns: readonly RemotePatternInput[] = []
): string[] {
  return [
    ...new Set(
      remotePatterns
        .filter(p => sourceExpression(p) === undefined)
        .map(p => (p instanceof URL ? p.href : p.hostname))
    ),
  ];
}

/**
 * The fetch directives a page built with this plugin needs, as a record.
 *
 * `'self'` is always present: the media library is same-origin, and it is the
 * path the refusal messages point authors at.
 */
export function cspDirectives(
  remotePatterns: readonly RemotePatternInput[] = [],
  options: CspOptions = {}
): Record<CspFetchDirective, string[]> {
  const { allowDataImages = true, allowBlobMedia = false } = options;

  const hosts = [
    ...new Set(
      remotePatterns
        .map(sourceExpression)
        .filter((source): source is string => source !== undefined)
    ),
  ];

  // A fresh array per directive. Sharing one meant a caller appending a frame
  // origin to the record silently widened `font-src` too, which is exactly the
  // kind of edit someone makes while merging this into an existing policy.
  const base = (): string[] => ["'self'", ...hosts];
  return {
    "img-src": [
      ...base(),
      ...(allowDataImages ? ["data:"] : []),
      ...(allowBlobMedia ? ["blob:"] : []),
    ],
    "media-src": [...base(), ...(allowBlobMedia ? ["blob:"] : [])],
    "frame-src": base(),
    "font-src": base(),
  };
}

/**
 * The same directives as a header value.
 *
 * Use this only when the response carries NO other policy. Where one exists,
 * {@link mergeCspDirectives} is the operation that works — see why there.
 */
export function cspHeaderValue(
  remotePatterns: readonly RemotePatternInput[] = [],
  options: CspOptions = {}
): string {
  const directives = cspDirectives(remotePatterns, options);
  return CSP_FETCH_DIRECTIVES.map(
    name => `${name} ${directives[name].join(" ")}`
  ).join("; ");
}

/**
 * One directive's sources, unioned with what a policy already allows.
 *
 * Policies INTERSECT. Sending a second policy alongside an existing one does
 * not extend it — a browser enforces both, so an existing `img-src 'self'`
 * still refuses a CDN however many other policies permit it. Nextly's own
 * default security headers send exactly that, so "send it alongside" would have
 * left the feature not working for every host using them.
 *
 * The operation that works is a union INTO the existing directive, which is
 * what this does. It is offered as a function because doing it by hand is the
 * mistake: the two policies look composable and are not.
 */
export function mergeCspDirectives(
  existing: Readonly<Record<string, readonly string[]>>,
  generated: Readonly<Record<string, readonly string[]>>
): Record<string, string[]> {
  const merged: Record<string, string[]> = {};
  for (const name of new Set([
    ...Object.keys(existing),
    ...Object.keys(generated),
  ])) {
    merged[name] = [
      ...new Set([...(existing[name] ?? []), ...(generated[name] ?? [])]),
    ];
  }
  return merged;
}

/** Parse a policy header into directives, so it can be merged and re-rendered. */
export function parseCspHeader(value: string): Record<string, string[]> {
  const directives: Record<string, string[]> = {};
  for (const clause of value.split(";")) {
    const [name, ...sources] = clause.trim().split(/\s+/);
    if (!name) continue;
    directives[name.toLowerCase()] = sources;
  }
  return directives;
}

/** Render directives back into a header value. */
export function serializeCspDirectives(
  directives: Readonly<Record<string, readonly string[]>>
): string {
  return Object.entries(directives)
    .map(([name, sources]) =>
      sources.length > 0 ? `${name} ${sources.join(" ")}` : name
    )
    .join("; ");
}
