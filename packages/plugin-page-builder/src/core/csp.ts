/**
 * Building the Content-Security-Policy fetch directives from the origin policy.
 *
 * The parser policy refuses a URL it can read. A CSP refuses a REQUEST, which
 * is a different guarantee and a stronger one here: it covers the surfaces a
 * parser cannot reach — a block registered outside this package, and a
 * cross-origin `<base href>` that re-points every relative URL on the page —
 * because it constrains the fetch rather than the text that describes it.
 *
 * Generated from the same `remotePatterns` the parser uses — but sharing an
 * input is not sharing a meaning. The two grammars read several of the same
 * words differently, so a faithful translation is not always available, and
 * the ones that are not are refused rather than approximated. What holds is a
 * one-directional invariant, and it is the whole contract of this module:
 *
 * > **The generated policy is never WIDER than the origin policy.**
 *
 * A source allowing more than the matcher does silently removes the
 * protection; one allowing less is a visible broken image with a named cause.
 * When only the second is on offer, take it — {@link unexpressibleHosts}
 * reports what was refused so the host can write that source itself.
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
 * ## No `script-src`
 *
 * Deliberately. The canonical Next.js recipe uses a per-request nonce, which
 * forces dynamic rendering on every page and would defeat tag-based ISR. A
 * nonce governs scripts; the channel this closes is where a RESOURCE comes
 * from, and a host allowlist is a static string that works unchanged under
 * static generation, ISR and dynamic rendering alike. Scripts remain the host
 * application's business.
 *
 * What IS emitted is the fetch directives plus `base-uri`. The one non-fetch
 * directive earns its place because a cross-origin `<base href>` re-points
 * every relative url on the page, and no fetch directive can express that.
 *
 * @module core/csp
 */

import type { RemotePattern, RemotePatternInput } from "./url-policy";

/** The fetch directives this generates, in the order they are emitted. */
export const CSP_FETCH_DIRECTIVES = [
  "img-src",
  "media-src",
  "frame-src",
  "font-src",
  // A stylesheet is a fetch like any other, and the one most worth bounding
  // here: a block registered outside this package renders its own markup, so
  // `<link rel="stylesheet" href={props.href}>` from author-controlled props
  // loads a stylesheet from anywhere — and a stylesheet is precisely where a
  // selector-gated `url()` turns a page's contents into a series of requests.
  // The parser policy never sees that file, so this directive is the only
  // thing standing in front of it.
  "style-src",
  // `'none'`, and present even though nothing here contributes sources to it.
  // A block registered outside this package renders its own markup, and an
  // `<object data="…">` fetches without a user action like any other resource.
  // With no `default-src` in a policy built from these directives alone, an
  // omitted `object-src` falls back to nothing and objects load freely — on
  // exactly the unparsed surface this policy exists to cover.
  "object-src",
] as const;

/**
 * Directives that bound the DOCUMENT rather than a fetch.
 *
 * `base-uri` is not a fetch directive and is here anyway, because a
 * cross-origin `<base href>` is one of the surfaces this policy exists to
 * cover and no fetch directive constrains it: a block that injects one
 * re-points every RELATIVE url on the page, which the parser policy allows
 * precisely because relative urls name no host. It also has no `default-src`
 * fallback, so it must be written to exist at all.
 */
export const CSP_DOCUMENT_DIRECTIVES = ["base-uri"] as const;

/** Every directive this generates, in the order they are emitted. */
export const CSP_DIRECTIVES = [
  ...CSP_FETCH_DIRECTIVES,
  ...CSP_DOCUMENT_DIRECTIVES,
] as const;

export type CspFetchDirective = (typeof CSP_FETCH_DIRECTIVES)[number];
export type CspDirective = (typeof CSP_DIRECTIVES)[number];

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
 * A pattern as CSP source expressions, or `undefined` when it has none.
 *
 * Usually one source; a terminal `/**` needs two to cover the same set. An
 * empty result is never returned — `undefined` is the only refusal.
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
 * - `port` distinguishes three cases, because to the matcher an ABSENT field
 *   and an empty one mean different things. Absent is any port, which CSP
 *   writes `:*`. Empty compares against the request's port after the URL
 *   parser has canonicalised a default away, so it means the default port —
 *   exactly what CSP means by omitting the port. Anything else is refused:
 *   `port: "443"` on https matches no request at all, since the parser removed
 *   the 443 before the comparison, and emitting it would allow an origin the
 *   pattern forbids.
 * - `hostname` must be literal, or one leading `*.` and literal after, and
 *   must already be lowercase. The rest of picomatch has no CSP equivalent and
 *   no safe approximation: widening `cdn-*.co.uk` to `*.co.uk` allows every
 *   site under a public suffix. Case matters because the two disagree about
 *   it — see {@link isExpressibleHost}.
 * - `pathname` must be absent, a `/prefix/**` glob, or a literal path, and
 *   must survive URL parsing and CSP's own path grammar unchanged — see
 *   {@link cspPaths}.
 * - `search` must be ABSENT, in any form. CSP does not match query strings at
 *   all, so `search: "?v=1"` and `search: ""` alike become a source that
 *   ignores the query the pattern was constraining. On the surfaces this
 *   backstops the query IS the channel — `url(https://cdn/a.png?secret)` — so
 *   this one is refused even though it costs a working config a source.
 */
function sourceExpressions(
  input: RemotePatternInput
): readonly string[] | undefined {
  // A `URL` carries three constraints at once that CSP cannot state: the
  // matcher reads `port === ""` (default port only), `pathname === "/"` (that
  // one path, where a CSP path of `/` is a prefix matching everything) and
  // `search === ""` (no query at all, which CSP never checks). Two of the
  // three are inexpressible in the widening direction, so every `URL` is
  // reported instead of translated.
  if (input instanceof URL) return undefined;
  const pattern: RemotePattern = input;

  // Exactly `https`. See the note above for why `http` and an omitted protocol
  // are both refused rather than approximated.
  if (pattern.protocol !== "https") return undefined;

  // Untrimmed: the matcher hands the raw value to picomatch, so a hostname with
  // surrounding whitespace matches nothing there. Trimming it here would emit a
  // host the pattern does not actually allow.
  const host = pattern.hostname;
  if (!isExpressibleHost(host)) return undefined;

  const port = cspPort(pattern.port);
  if (port === undefined) return undefined;

  if (pattern.search !== undefined) return undefined;

  const paths = cspPaths(pattern.pathname);
  if (paths === undefined) return undefined;

  return paths.map(path => `https://${host}${port}${path}`);
}

/**
 * A pattern port as a CSP port suffix, or `undefined` when it cannot be one.
 *
 * Absent and empty are both meaningful and they are not the same: the matcher
 * skips the comparison entirely for an absent port and requires equality with
 * the request's canonicalised port for an empty one.
 */
function cspPort(port: string | undefined): string | undefined {
  if (port === undefined) return ":*";
  if (port === "") return "";
  return undefined;
}

/**
 * A pattern pathname as CSP paths, or `undefined` when it cannot be expressed.
 *
 * CSP path matching is a prefix when the path ends in `/`, and exact otherwise.
 * A terminal `/**` needs BOTH forms: picomatch matches `/img` itself as well as
 * everything below it, while the CSP path `/img/` covers only the descendants —
 * so the prefix is emitted alongside it as an exact source. `/img/*` bounds the
 * match to a single segment, which CSP has no way to say at all.
 *
 * The characters are restricted to those that survive both sides untouched.
 * CSP's `path-part` excludes `;` and `,` outright, and a `;` reaching the
 * header would end the directive and start a new one — a literal pathname of
 * `/x; script-src https:` turns a fetch policy into a script policy. Beyond
 * those two, anything the URL parser would percent-encode (or that arrives
 * already encoded) is refused as well: CSP decodes both sides before comparing
 * paths and picomatch does not, so an encoded path is a third place the two
 * disagree.
 */
function cspPaths(pathname: string | undefined): readonly string[] | undefined {
  // Only an ABSENT pathname means any path. The matcher reaches its `** `
  // default through `pattern.pathname ?? "**"`, which an empty string does not
  // trigger — it arrives at picomatch as an empty glob, where `makeRe` throws
  // rather than matching anything. Reading it as "omitted" would emit a
  // host-wide source for a pattern that admits no request at all.
  if (pathname === undefined || pathname === "**") return [""];
  if (!pathname.startsWith("/")) return undefined;

  if (pathname.endsWith("/**")) {
    const prefix = pathname.slice(0, -3);
    // `/**` is every path, which is what an omitted path already says.
    if (prefix === "") return [""];
    // A trailing slash before the glob would make the prefix source `/a/`,
    // whose own trailing slash CSP reads as "everything below `/a`" — wider
    // than the `//` the pattern actually requires.
    if (prefix.includes("*") || prefix.endsWith("/")) return undefined;
    if (!isExpressiblePath(prefix)) return undefined;
    return [prefix, `${prefix}/`];
  }

  if (pathname.includes("*")) return undefined;
  // A literal ending in `/` is where the two grammars invert. picomatch reads
  // `/tenant/` as that exact path; CSP reads a trailing slash as a PREFIX, so
  // the same text would allow `/tenant/private.png`. `/` is the extreme case,
  // an exact path to the matcher and the whole origin to CSP. The prefix form
  // is emitted only from the terminal `/**` branch above, where it is what the
  // pattern means.
  if (pathname.endsWith("/")) return undefined;
  if (!isExpressiblePath(pathname)) return undefined;
  return [pathname];
}

/**
 * Whether a path is written only in characters both sides read identically.
 *
 * The unreserved set from RFC 3986 plus the separator. Everything else is
 * either percent-encoded by the URL parser before picomatch sees it, excluded
 * from CSP's `path-part` grammar, or a delimiter that would restructure the
 * header.
 */
function isExpressiblePath(path: string): boolean {
  return /^\/[A-Za-z0-9\-._~/]*$/.test(path);
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
 *
 * Lowercase only, and that is a real restriction rather than a tidiness rule.
 * CSP matches hosts case-insensitively while picomatch is case-sensitive
 * against a hostname the URL parser has already lowercased — so `CDN.example`
 * matches no request at all through the matcher, and a source emitted from it
 * would allow every request to `cdn.example`.
 */
function isExpressibleHost(host: string): boolean {
  const body = host.startsWith("*.") ? host.slice(2) : host;
  return /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.?$/.test(body);
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
        .filter(p => sourceExpressions(p) === undefined)
        .map(p => (p instanceof URL ? p.href : p.hostname))
    ),
  ];
}

/**
 * The directives a page built with this plugin needs, as a record.
 *
 * `'self'` is always present: the media library is same-origin, and it is the
 * path the refusal messages point authors at.
 *
 * `style-src` carries `'unsafe-inline'` because the renderer emits its scoped
 * CSS as inline `<style>` elements — the node styles, the sanitized custom CSS
 * and several first-party blocks each write one. The alternative is a
 * per-request nonce, which is the same trade refused for `script-src`: it
 * forces dynamic rendering and defeats ISR. This matches the Next.js
 * nonce-free CSP recipe, which is also `style-src 'self' 'unsafe-inline'`, and
 * it does not give up what this policy is for — the HOST a stylesheet loads
 * from stays bounded, which is the part `remotePatterns` backstops. Inline CSS
 * is already read by the sanitizer, which the stylesheet on a remote host
 * never is.
 */
export function cspDirectives(
  remotePatterns: readonly RemotePatternInput[] = [],
  options: CspOptions = {}
): Record<CspDirective, string[]> {
  const { allowDataImages = true, allowBlobMedia = false } = options;

  const hosts = [
    ...new Set(
      remotePatterns.flatMap(pattern => sourceExpressions(pattern) ?? [])
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
    "style-src": [...base(), "'unsafe-inline'"],
    "object-src": ["'none'"],
    // `'self'` rather than `'none'`: a host legitimately sets a `<base>` for
    // its own routing, and this only has to stop one pointing off-origin.
    "base-uri": ["'self'"],
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
  return CSP_DIRECTIVES.map(
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
 * mistake: the two policies look composable and are not, and the union has a
 * case that reads as a detail and is not one — a directive permitting NOTHING
 * cannot be unioned with anything, in either direction, without changing what
 * it permits. See {@link isNoSources} and the note at the union itself.
 *
 * What the host declared explicitly is left as they wrote it wherever the
 * union cannot tighten it; this edits a policy for a document it does not own.
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
    const inherited = before.has(name)
      ? before.get(name)
      : inheritedSources(name, before);

    // `'none'` is only meaningful as a directive's ONLY source. CSP 3 special-
    // cases it when the list holds exactly one item, so in any longer list it
    // is an expression matching nothing and the REST of the list governs. That
    // makes a union wrong in both directions, and silently so:
    //
    // - unioning sources into an inherited `'none'` ACTIVATES them, turning
    //   `img-src 'none'` into `img-src 'none' https://cdn` — which allows the
    //   CDN the host had blocked outright;
    // - unioning `'none'` into anything is a no-op, so seeding the generated
    //   `object-src 'none'` from `default-src 'self'` yields
    //   `object-src 'self' 'none'` and objects keep loading.
    //
    // So `'none'` never takes part in a union. Whichever side holds it decides
    // the directive alone.
    if (inherited !== undefined && isNoSources(inherited)) {
      merged[name] = [...inherited];
      continue;
    }
    if (isNoSources(sources)) {
      // A directive the host declared is theirs: this cannot tighten it by
      // union, and overriding it outright would break embeds elsewhere in a
      // document this package does not own. Where they left it unstated, the
      // generated `'none'` stands on its own rather than inheriting.
      if (!before.has(name)) merged[name] = [...sources];
      continue;
    }
    merged[name] = [...new Set([...(inherited ?? []), ...sources])];
  }
  return merged;
}

/**
 * What an UNSTATED directive was already being enforced with.
 *
 * `undefined` where nothing was, which is not the same as an empty list — that
 * would read as "permits nothing" and stop sources being added at all.
 *
 * Not every directive falls back. The fetch directives inherit `default-src`,
 * and `frame-src` prefers `child-src` ahead of it, but a document directive
 * like `base-uri` has no fallback at all: unstated, it restricts nothing.
 * Seeding it from `default-src` would hand it sources the host never granted
 * it — a policy with `default-src https://cdn.example` would come back
 * permitting a `<base>` pointing at that CDN.
 */
function inheritedSources(
  name: string,
  before: Map<string, readonly string[]>
): readonly string[] | undefined {
  if ((CSP_DOCUMENT_DIRECTIVES as readonly string[]).includes(name))
    return undefined;
  if (name === "frame-src") {
    const child = before.get("child-src");
    if (child !== undefined) return child;
  }
  return before.get("default-src");
}

/**
 * Whether a source list permits nothing.
 *
 * `'none'` is matched case-insensitively, as CSP compares it. An EMPTY list
 * counts too: a directive written with no sources at all is equivalent to one
 * holding `'none'`, and {@link parseCspHeader} produces exactly that for a bare
 * `img-src` clause.
 */
function isNoSources(sources: readonly string[]): boolean {
  if (sources.length === 0) return true;
  return sources.length === 1 && sources[0].toLowerCase() === "'none'";
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
