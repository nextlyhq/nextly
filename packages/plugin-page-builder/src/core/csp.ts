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
  const pattern: RemotePattern =
    input instanceof URL
      ? {
          // A `URL` writes `https:` where a pattern writes `https`; both mean
          // the same scheme.
          ...(input.protocol === "http:" || input.protocol === "https:"
            ? { protocol: input.protocol.slice(0, -1) as "http" | "https" }
            : {}),
          hostname: input.hostname,
          ...(input.port ? { port: input.port } : {}),
        }
      : input;

  const host = pattern.hostname.trim();
  if (host === "") return undefined;

  // CSP host sources accept ONE leading `*.` wildcard and nothing else, while
  // `remotePatterns` hostnames are picomatch globs. A glob CSP cannot express
  // is widened to its nearest expressible ancestor rather than dropped: a
  // dropped host would make the CSP refuse media the page is configured to
  // show, and a CSP that breaks the page is a CSP that gets removed.
  const expressible = /^[A-Za-z0-9.-]+$/.test(host)
    ? host
    : wildcardAncestor(host);
  if (expressible === undefined) return undefined;

  const scheme = pattern.protocol ? `${pattern.protocol}://` : "";
  const port = pattern.port ? `:${pattern.port}` : "";
  return `${scheme}${expressible}${port}`;
}

/**
 * The nearest `*.suffix` a glob hostname can be expressed as.
 *
 * `**.example.com` and `cdn-*.example.com` both become `*.example.com`: wider
 * than the pattern, and still narrower than allowing every host. `undefined`
 * when no literal suffix survives, which is the case where widening would mean
 * allowing anything at all.
 */
function wildcardAncestor(host: string): string | undefined {
  const labels = host.split(".");
  const firstLiteral = labels.findIndex(
    label => label !== "" && /^[A-Za-z0-9-]+$/.test(label)
  );
  if (firstLiteral === -1) return undefined;
  const suffix = labels.slice(firstLiteral).join(".");
  // Every remaining label must be literal; a glob in the middle cannot be
  // expressed at all.
  if (!/^[A-Za-z0-9.-]+$/.test(suffix)) return undefined;
  // A bare public suffix would allow every site under it, which is not a
  // restriction worth writing.
  return labels.length > firstLiteral + 1 || firstLiteral > 0
    ? `*.${suffix}`
    : suffix;
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

  const base = ["'self'", ...hosts];
  return {
    "img-src": [
      ...base,
      ...(allowDataImages ? ["data:"] : []),
      ...(allowBlobMedia ? ["blob:"] : []),
    ],
    "media-src": [...base, ...(allowBlobMedia ? ["blob:"] : [])],
    "frame-src": base,
    "font-src": base,
  };
}

/**
 * The same directives as a header value, ready to merge into the host's policy.
 *
 * Merge rather than replace. Policies intersect, so sending this alongside an
 * existing one enforces both; sending it INSTEAD of one drops whatever else the
 * host was protecting.
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
