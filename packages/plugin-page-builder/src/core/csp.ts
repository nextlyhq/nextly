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
  // `'none'`, and present even though nothing here contributes sources to it.
  // A block registered outside this package renders its own markup, and an
  // `<object data="…">` fetches without a user action like any other resource.
  // With no `default-src` in a policy built from these directives alone, an
  // omitted `object-src` falls back to nothing and objects load freely — on
  // exactly the unparsed surface this policy exists to cover.
  "object-src",
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

/**
 * A pattern as a CSP source expression, or `undefined` when it has none.
 *
 * `undefined` is the answer whenever the translation would not be EXACT, and
 * the reasons are worth stating because each is a place the two systems use the
 * same word differently:
 *
 * - `protocol` must be `https`. A CSP `http://` source matches https requests
 *   too (CSP 3 upgrades insecure schemes), while the matcher compares schemes
 *   exactly — so an http pattern becomes a source allowing more than the
 *   pattern does. An omitted protocol means either scheme to the matcher and
 *   the document's own scheme to CSP, which is a mismatch in the other
 *   direction.
 * - `port` must be absent, meaning ANY port to the matcher, which CSP writes as
 *   `:*`. An explicit port is refused: the URL parser canonicalises a default
 *   port away before the matcher compares it, so `port: "443"` on https matches
 *   no request at all, and emitting it would allow an origin the pattern
 *   forbids.
 * - `hostname` must be literal, or one leading `*.` and literal after. The rest
 *   of picomatch has no CSP equivalent and no safe approximation: widening
 *   `cdn-*.co.uk` to `*.co.uk` allows every site under a public suffix.
 * - `pathname` must be absent or a `/prefix/**` glob, which CSP expresses as a
 *   path ending in `/`. `/img/*` bounds the match to one segment and CSP cannot
 *   say that.
 * - `search` must be absent. CSP does not match query strings, so a pattern
 *   restricting one would become a source that does not.
 */
function sourceExpression(input: RemotePatternInput): string | undefined {
  const pattern: RemotePattern | undefined =
    input instanceof URL ? fromUrl(input) : input;
  if (pattern === undefined) return undefined;

  // Exactly `https`. See the note above for why `http` and an omitted protocol
  // are both refused rather than approximated.
  if (pattern.protocol !== "https") return undefined;

  // Untrimmed: the matcher hands the raw value to picomatch, so a hostname with
  // surrounding whitespace matches nothing there. Trimming it here would emit a
  // host the pattern does not actually allow.
  const host = pattern.hostname;
  if (!isExpressibleHost(host)) return undefined;

  // An explicit port cannot be expressed faithfully; an absent one means any
  // port, which is `:*`.
  if (pattern.port !== undefined && pattern.port !== "") return undefined;
  if (pattern.search !== undefined && pattern.search !== "") return undefined;

  const path = cspPath(pattern.pathname);
  if (path === undefined) return undefined;

  return `https://${host}:*${path}`;
}

/** A `URL` reduced to the pattern fields, or `undefined` when it cannot be. */
function fromUrl(url: URL): RemotePattern | undefined {
  if (url.protocol !== "https:") return undefined;
  // A `URL` always carries a pathname, and `/` means "this path only" to the
  // matcher — which is not what a bare origin usually intends and not something
  // to guess about.
  if (url.pathname !== "/" || url.search !== "") return undefined;
  return {
    protocol: "https",
    hostname: url.hostname,
    // An empty port on a `URL` means the default port, which the matcher
    // compares against the request's canonicalised (empty) port. That is a
    // faithful "any port" only because both sides are empty.
    ...(url.port === "" ? {} : { port: url.port }),
  };
}

/**
 * A pattern pathname as a CSP path, or `undefined` when it cannot be expressed.
 *
 * CSP path matching is a prefix when the path ends in `/`, and exact otherwise.
 * That covers `/img/**` and a literal path; `/img/*` bounds the match to a
 * single segment, which CSP has no way to say.
 */
function cspPath(pathname: string | undefined): string | undefined {
  if (pathname === undefined || pathname === "" || pathname === "**") return "";
  if (!pathname.startsWith("/")) return undefined;
  const prefix = pathname.slice(0, -3);
  if (pathname.endsWith("/**") && !prefix.includes("*")) return `${prefix}/`;
  if (!pathname.includes("*")) return pathname;
  return undefined;
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
    "object-src": ["'none'"],
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
  // Directive names are case-insensitive to CSP. Comparing them as written
  // would emit `IMG-SRC` and `img-src` as two directives, and a browser honours
  // the FIRST — so the generated sources would be the ones ignored.
  const normalise = (
    source: Readonly<Record<string, readonly string[]>>
  ): Map<string, readonly string[]> => {
    const out = new Map<string, readonly string[]>();
    // First occurrence wins, which is what a browser does with a repeated
    // directive. Taking the last would activate sources the browser was
    // ignoring, widening the host's policy by reserialising it.
    for (const [name, sources] of Object.entries(source)) {
      const key = name.toLowerCase();
      if (!out.has(key)) out.set(key, sources);
    }
    return out;
  };

  const before = normalise(existing);
  const add = normalise(generated);
  const merged: Record<string, string[]> = {};

  for (const [name, sources] of before) merged[name] = [...sources];

  for (const [name, sources] of add) {
    // A directive the host does not declare is INHERITED from `default-src`
    // (or, for `frame-src`, from `child-src` first). Writing an explicit one
    // stops that inheritance, so it has to start from what was being inherited
    // — otherwise adding an image source removes every image source the host
    // was relying on `default-src` to provide.
    const inherited =
      merged[name] ??
      (name === "frame-src" ? before.get("child-src") : undefined) ??
      before.get("default-src") ??
      [];
    merged[name] = [...new Set([...inherited, ...sources])];
  }
  return merged;
}

/** Parse a policy header into directives, so it can be merged and re-rendered. */
export function parseCspHeader(value: string): Record<string, string[]> {
  const directives: Record<string, string[]> = {};
  for (const clause of value.split(";")) {
    const [name, ...sources] = clause.trim().split(/\s+/);
    if (!name) continue;
    const key = name.toLowerCase();
    // First occurrence wins, which is what a browser does with a repeated
    // directive. Overwriting with the last would activate sources the browser
    // was ignoring, so merely parsing and reserialising a policy would widen
    // it — before anything was even merged in.
    if (key in directives) continue;
    directives[key] = sources;
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
