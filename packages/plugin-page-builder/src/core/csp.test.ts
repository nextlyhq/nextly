/**
 * The generated policy must never be WIDER than the origin policy it backstops.
 *
 * Both describe "which hosts may this page fetch from", in grammars that do not
 * correspond — so most of these cases are a word the two systems read
 * differently. Where the translation is not exact the pattern is refused and
 * reported rather than approximated: a source allowing more than the matcher
 * does silently removes the protection, while one allowing less is a visible
 * broken image with a named cause.
 */
import { describe, expect, it } from "vitest";

import {
  CSP_FETCH_DIRECTIVES,
  cspDirectives,
  cspHeaderValue,
  mergeCspDirectives,
  parseCspHeader,
  serializeCspDirectives,
  unexpressibleHosts,
  unmergeableStylePolicy,
} from "./csp";

/** What `img-src` holds before any pattern contributes a source. */
const SELF_ONLY = ["'self'", "data:"];

describe("cspDirectives — what translates exactly", () => {
  it("expresses an https host as any-port, matching the pattern", () => {
    // A pattern with no port allows ANY port; CSP writes that `:*`. Omitting
    // it would mean the default port only, blocking what the site allows.
    const d = cspDirectives([{ protocol: "https", hostname: "cdn.example" }]);
    expect(d["img-src"]).toContain("https://cdn.example:*");
  });

  it("expresses one leading wildcard label", () => {
    const d = cspDirectives([{ protocol: "https", hostname: "*.example.com" }]);
    expect(d["img-src"]).toContain("https://*.example.com:*");
  });

  it("expresses a default-port pattern by omitting the port", () => {
    // An EMPTY port is not an absent one: the matcher compares it against the
    // request's port after the parser has canonicalised a default away, so it
    // means the default port — which is what CSP means by writing no port.
    // `port: ""` is the shape the Next.js docs use, so refusing it would cost
    // the common config its sources.
    const d = cspDirectives([
      { protocol: "https", hostname: "cdn.example", port: "" },
    ]);
    expect(d["img-src"]).toContain("https://cdn.example");
    expect(d["img-src"]).not.toContain("https://cdn.example:*");
  });

  it("treats an unconstrained path glob as no path at all", () => {
    // `**` and `/**` match every path, which is exactly what a source with no
    // path-part already says, so these still translate.
    for (const pathname of ["**", "/**"])
      expect(
        cspDirectives([
          { protocol: "https", hostname: "cdn.example", pathname },
        ])["img-src"],
        pathname
      ).toContain("https://cdn.example:*");
  });

  it("expresses a protocol-less pattern as http, which covers both schemes", () => {
    // CSP defines `http://h` as equivalent to `http://h https://h`, which is
    // exactly what an absent protocol means to the matcher. Writing `https`
    // instead would drop the http half the pattern allows.
    const d = cspDirectives([{ hostname: "cdn.example" }]);
    expect(d["img-src"]).toContain("http://cdn.example:*");
  });

  it("expresses a non-default port exactly", () => {
    const d = cspDirectives([
      { protocol: "https", hostname: "cdn.example", port: "8443" },
    ]);
    expect(d["img-src"]).toContain("https://cdn.example:8443");
  });

  it("normalises a double-star subdomain glob to the single-star form", () => {
    // The two accept an identical set through picomatch — every depth of
    // subdomain, never the apex — and CSP's rule is the same suffix test.
    const d = cspDirectives([
      { protocol: "https", hostname: "**.example.com" },
    ]);
    expect(d["img-src"]).toContain("https://*.example.com:*");
  });

  it("carries a host into every fetch directive", () => {
    const d = cspDirectives([{ protocol: "https", hostname: "cdn.example" }]);
    // Every directive that takes hosts, so a newly added one cannot quietly
    // stay on `'self'` while the rest carry the allowlist.
    for (const name of CSP_FETCH_DIRECTIVES) {
      if (name === "object-src") continue; // `'none'`, and takes no hosts
      expect(d[name], name).toContain("https://cdn.example:*");
    }
  });

  it("lists each host once however many patterns name it", () => {
    const d = cspDirectives([
      { protocol: "https", hostname: "cdn.example" },
      { protocol: "https", hostname: "cdn.example" },
    ]);
    expect(
      d["img-src"].filter(s => s === "https://cdn.example:*")
    ).toHaveLength(1);
  });
});

describe("cspDirectives — what is refused rather than approximated", () => {
  const refused = (pattern: Parameters<typeof cspDirectives>[0][number]) =>
    cspDirectives([pattern])["img-src"];

  it("refuses http, because a CSP http source also matches https", () => {
    // CSP 3 upgrades insecure schemes, so `http://h` allows `https://h` too,
    // while the matcher compares schemes exactly.
    expect(refused({ protocol: "http", hostname: "cdn.example" })).toEqual(
      SELF_ONLY
    );
  });

  it("refuses a DEFAULT port, which the matcher can never match", () => {
    // The URL parser removes a default port before the matcher compares it, so
    // `port: "443"` on https matches no request — while a CSP source naming it
    // matches the canonical form, which is wider. Non-canonical spellings go
    // the same way: CSP reads `0443` as decimal 443, the matcher compares the
    // string and never matches.
    for (const port of ["443", "0443", "44a", ""])
      if (port !== "")
        expect(
          refused({ protocol: "https", hostname: "cdn.example", port }),
          port
        ).toEqual(SELF_ONLY);
  });

  it("refuses a default port of EITHER scheme when the protocol is absent", () => {
    // A protocol-less pattern is written `http://`, which CSP also matches
    // against https — so both 80 and 443 are defaults this source could match
    // where the matcher would not.
    for (const port of ["80", "443"])
      expect(refused({ hostname: "cdn.example", port }), port).toEqual(
        SELF_ONLY
      );
  });

  it("refuses a glob CSP cannot express, rather than widening it", () => {
    // Widening `cdn-*.co.uk` to `*.co.uk` allows every site under a public
    // suffix, and telling a public suffix apart needs a list this package has
    // no business shipping. `*` alone would allow every host, which is not a
    // backstop.
    for (const hostname of ["cdn-*.com", "cdn-*.co.uk", "*", ""])
      expect(refused({ protocol: "https", hostname }), hostname).toEqual(
        SELF_ONLY
      );
  });

  it("refuses an IP literal, which matches no host-source at all", () => {
    // CSP host matching begins "if host is not a domain, return Does Not
    // Match", so a source naming an address can never match — it would
    // silently block media the allowlist permits.
    for (const hostname of ["192.168.0.1", "127.0.0.1", "10.0.0.1"])
      expect(refused({ protocol: "https", hostname }), hostname).toEqual(
        SELF_ONLY
      );
  });

  it("refuses a hostname with whitespace instead of trimming it", () => {
    // The matcher hands the raw value to picomatch, where it matches nothing.
    expect(refused({ protocol: "https", hostname: " cdn.example " })).toEqual(
      SELF_ONLY
    );
  });

  it("refuses every path CONSTRAINT, which CSP cannot hold", () => {
    // CSP checks a source's path only when `redirect count` is 0, so an
    // allowed URL that redirects elsewhere on the same host keeps passing;
    // and it percent-decodes both sides before comparing, so `/logo.png` also
    // admits `/logo%2Epng`, which the matcher rejects. Both widen, and neither
    // can be written around — so a path-scoped pattern gets no source at all.
    for (const pathname of [
      "/img/**", // a prefix a redirect would escape
      "/logo.png", // an exact path with an encoded alias
      "/img/*", // one segment, which CSP cannot bound
      "/tenant/", // exact to the matcher, a prefix to CSP
      "/",
      "", // not the any-path case: picomatch throws on an empty glob
    ])
      expect(
        refused({ protocol: "https", hostname: "cdn.example", pathname }),
        pathname
      ).toEqual(SELF_ONLY);
  });

  it("refuses a search constraint in either form", () => {
    // CSP never matches a query, so a pattern constraining one becomes a
    // source that does not. `search: ""` is the sharper case: it permits only
    // queryless URLs, while the emitted source would allow any query at all —
    // and on the surfaces this backstops the query IS the exfiltration
    // channel, so this is refused despite being a shape real configs use.
    for (const search of ["?v=1", ""])
      expect(
        refused({ protocol: "https", hostname: "cdn.example", search }),
        JSON.stringify(search)
      ).toEqual(SELF_ONLY);
  });

  it("refuses an uppercase hostname, which the matcher cannot match", () => {
    // picomatch compares case-sensitively against a hostname the URL parser
    // has already lowercased, so this pattern matches no request — while CSP
    // matches hosts case-insensitively, making the source strictly wider.
    expect(refused({ protocol: "https", hostname: "CDN.example" })).toEqual(
      SELF_ONLY
    );
  });

  it("emits no path at all, so no path can restructure the header", () => {
    // A semicolon in a source ends the directive and starts a new one, so a
    // pathname of `/x; script-src https:` would have appended a script policy
    // to a header that deliberately declares none. Refusing every path
    // constraint closes that structurally rather than by escaping.
    const value = cspHeaderValue([
      {
        protocol: "https",
        hostname: "cdn.example",
        pathname: "/x; script-src https:",
      },
    ]);
    expect(value).not.toMatch(/script-src/);
    expect(value).not.toMatch(/cdn\.example/);
  });

  it("refuses every URL pattern, which carries constraints CSP cannot state", () => {
    // The matcher reads a `URL` as default-port, that-path-only and
    // queryless. A CSP path of `/` is a PREFIX matching everything and CSP
    // never checks a query, so two of the three can only be translated wider.
    for (const url of [
      new URL("ftp://cdn.example/a"),
      new URL("https://cdn.example/img/a.png"),
      new URL("https://cdn.example"),
    ])
      expect(cspDirectives([url])["img-src"], url.href).toEqual(SELF_ONLY);
  });

  it("names every host it refused", () => {
    // Refusing silently would leave the CSP blocking media the page is
    // configured to show, with nothing to point the host at.
    expect(
      unexpressibleHosts([
        { protocol: "http", hostname: "insecure.example" },
        { protocol: "https", hostname: "cdn-*.com" },
        { protocol: "https", hostname: "ok.example" },
      ])
    ).toEqual(["insecure.example", "cdn-*.com"]);
  });
});

describe("cspDirectives — the directives themselves", () => {
  it("forbids objects, which no pattern can allow", () => {
    // A block registered outside this package renders its own markup, and
    // `<object data>` fetches like any other resource. With no `default-src` in
    // a policy built from these alone, an omitted `object-src` falls back to
    // nothing.
    expect(cspDirectives()["object-src"]).toEqual(["'none'"]);
  });

  it("allows this origin, and data: images, by default", () => {
    const d = cspDirectives();
    expect(d["img-src"]).toEqual(SELF_ONLY);
    expect(d["frame-src"]).toEqual(["'self'"]);
  });

  it("gives each directive its own array", () => {
    const d = cspDirectives([{ protocol: "https", hostname: "cdn.example" }]);
    d["frame-src"].push("https://player.example");
    expect(d["font-src"]).not.toContain("https://player.example");
  });

  it("never emits script-src, which the host owns", () => {
    expect(Object.keys(cspDirectives())).not.toContain("script-src");
  });

  it("bounds where a stylesheet may be loaded from", () => {
    // A block registered outside this package renders its own markup, so
    // `<link rel="stylesheet" href={…}>` fetches a file the parser policy
    // never reads — and a stylesheet is where a selector-gated `url()` turns
    // page contents into requests.
    const d = cspDirectives([{ protocol: "https", hostname: "cdn.example" }]);
    expect(d["style-src"]).toContain("https://cdn.example:*");
    expect(d["style-src"]).toContain("'self'");
    // Asserted on the HEADER too, not just the record. The record is keyed
    // independently of the list the header is serialized from, so a directive
    // dropped from that list would still be present here while vanishing from
    // what the browser is actually sent.
    expect(
      cspHeaderValue([{ protocol: "https", hostname: "cdn.example" }])
    ).toContain("style-src 'self' https://cdn.example:* 'unsafe-inline'");
  });

  it("still allows the inline styles the renderer emits", () => {
    // The scoped node CSS, the sanitized custom CSS and several first-party
    // blocks are each an inline `<style>`. The alternative is a per-request
    // nonce, which is the trade refused for script-src: it defeats ISR.
    expect(cspDirectives()["style-src"]).toContain("'unsafe-inline'");
  });

  it("stops a block re-pointing relative urls with a cross-origin base", () => {
    // No fetch directive constrains `<base href>`, and it has no default-src
    // fallback, so it has to be written out to exist at all.
    expect(cspDirectives()["base-uri"]).toEqual(["'self'"]);
    expect(cspHeaderValue()).toContain("base-uri 'self'");
  });
});

describe("merging into an existing policy", () => {
  it("unions into the directive that already exists", () => {
    // Policies INTERSECT: an existing `img-src 'self'` refuses a CDN however
    // many other policies allow it.
    const merged = mergeCspDirectives(
      parseCspHeader("default-src 'self'; img-src 'self' data:"),
      cspDirectives([{ protocol: "https", hostname: "cdn.example" }])
    );
    expect(merged["img-src"]).toContain("https://cdn.example:*");
    expect(merged["default-src"]).toEqual(["'self'"]);
  });

  it("keeps what a new directive was inheriting from default-src", () => {
    // Writing an explicit `img-src` stops it inheriting `default-src`, so it
    // has to start from what was inherited — otherwise adding an image source
    // removes every source the host relied on the fallback to provide.
    const merged = mergeCspDirectives(
      parseCspHeader("default-src 'self' https://assets.example"),
      cspDirectives([{ protocol: "https", hostname: "cdn.example" }])
    );
    expect(merged["img-src"]).toContain("https://assets.example");
    expect(merged["img-src"]).toContain("https://cdn.example:*");
  });

  it("prefers child-src over default-src when seeding frame-src", () => {
    const merged = mergeCspDirectives(
      parseCspHeader("default-src 'self'; child-src https://frames.example"),
      cspDirectives()
    );
    expect(merged["frame-src"]).toContain("https://frames.example");
  });

  it("keeps the FIRST of duplicate directives, as a browser does", () => {
    // Reserialising with the last would activate sources the browser was
    // ignoring, widening the host's policy by rewriting it.
    const merged = mergeCspDirectives(
      parseCspHeader("img-src 'self'; img-src https://legacy.example"),
      {}
    );
    expect(merged["img-src"]).toEqual(["'self'"]);
  });

  it("does not let an inherited fallback defeat object-src 'none'", () => {
    // CSP special-cases `'none'` only when it is a list's ONLY item, so
    // seeding from `default-src` would produce `object-src 'self' 'none'` —
    // in which `'none'` matches nothing, `'self'` still matches, and
    // same-origin objects keep loading on the surface this forbids them on.
    const merged = mergeCspDirectives(
      parseCspHeader("default-src 'self'"),
      cspDirectives()
    );
    expect(merged["object-src"]).toEqual(["'none'"]);
  });

  it("leaves a directive the host declared as 'none' alone", () => {
    // The same rule read the other way. Unioning sources into `'none'` would
    // ACTIVATE them: `img-src 'none' https://cdn.example:*` allows the CDN the
    // host had blocked outright, so merging would widen the policy it edits.
    const merged = mergeCspDirectives(
      parseCspHeader("img-src 'none'"),
      cspDirectives([{ protocol: "https", hostname: "cdn.example" }])
    );
    expect(merged["img-src"]).toEqual(["'none'"]);
  });

  it("treats a valueless directive as 'none', because CSP does", () => {
    // A directive written with no sources permits nothing, exactly as `'none'`
    // does, so it must not be unioned into either.
    const merged = mergeCspDirectives(
      parseCspHeader("img-src"),
      cspDirectives([{ protocol: "https", hostname: "cdn.example" }])
    );
    expect(merged["img-src"]).toEqual([]);
  });

  it("keeps an inherited 'none' when the directive is unstated", () => {
    const merged = mergeCspDirectives(
      parseCspHeader("default-src 'none'"),
      cspDirectives([{ protocol: "https", hostname: "cdn.example" }])
    );
    expect(merged["img-src"]).toEqual(["'none'"]);
  });

  it("does not seed base-uri from default-src, which it never inherits", () => {
    // `base-uri` has no fallback: unstated, it restricts nothing. Treating
    // `default-src` as inherited would hand it sources the host never granted
    // it — here, a `<base>` pointing at the CDN.
    const merged = mergeCspDirectives(
      parseCspHeader("default-src 'self' https://cdn.example"),
      cspDirectives()
    );
    expect(merged["base-uri"]).toEqual(["'self'"]);
  });

  it("leaves an explicit base-uri exactly as the host wrote it", () => {
    // `base-uri` carries no pattern-derived source, so the generated `'self'`
    // is a default rather than an addition. A host writing
    // `base-uri https://cdn.example` had deliberately excluded a same-origin
    // `<base href>`; unioning `'self'` in would hand back the very injection
    // the directive exists to stop.
    const merged = mergeCspDirectives(
      parseCspHeader("base-uri https://cdn.example"),
      cspDirectives()
    );
    expect(merged["base-uri"]).toEqual(["https://cdn.example"]);
  });

  it("carries the style hosts into style-src-elem when the host splits it", () => {
    // `style-src-elem` governs a stylesheet IN PLACE OF `style-src`, so a
    // policy that declares both would take the generated hosts into the one
    // that is not consulted and keep blocking the stylesheet.
    const merged = mergeCspDirectives(
      parseCspHeader("style-src 'self'; style-src-elem 'self'"),
      cspDirectives([{ protocol: "https", hostname: "cdn.example" }])
    );
    expect(merged["style-src-elem"]).toContain("https://cdn.example:*");
    expect(merged["style-src"]).toContain("https://cdn.example:*");
  });

  it("does not invent a style-src-elem the host never declared", () => {
    // Writing one would split a policy the host kept whole, and `style-src`
    // already governs where there is no more specific directive.
    const merged = mergeCspDirectives(
      parseCspHeader("style-src 'self'"),
      cspDirectives([{ protocol: "https", hostname: "cdn.example" }])
    );
    expect(Object.keys(merged)).not.toContain("style-src-elem");
  });

  it("carries the style hosts into style-src-attr when the host splits it", () => {
    // `style-src-attr` governs a `style="…"` attribute in place of
    // `style-src`, and the renderer puts one on almost every node — so a host
    // that splits it would go on blocking the layout it is rendering.
    const merged = mergeCspDirectives(
      parseCspHeader("style-src 'self'; style-src-attr 'self'"),
      cspDirectives([{ protocol: "https", hostname: "cdn.example" }])
    );
    expect(merged["style-src-attr"]).toContain("'unsafe-inline'");
  });

  it("does not reopen a style-src-elem the host closed", () => {
    // Declared as permitting nothing. A union would drop the `'none'` to a
    // non-single position, where CSP ignores it and the CDN would load.
    const merged = mergeCspDirectives(
      parseCspHeader("style-src 'self'; style-src-elem 'none'"),
      cspDirectives([{ protocol: "https", hostname: "cdn.example" }])
    );
    expect(merged["style-src-elem"]).toEqual(["'none'"]);
  });

  it("keeps the host's own object-src rather than overriding it", () => {
    // Their document, their embeds: a union cannot tighten this, and replacing
    // it outright would break `<object>` elsewhere on a page this does not own.
    const merged = mergeCspDirectives(
      parseCspHeader("object-src 'self'"),
      cspDirectives()
    );
    expect(merged["object-src"]).toEqual(["'self'"]);
  });

  it("treats directive names case-insensitively, as CSP does", () => {
    const merged = mergeCspDirectives(
      { "IMG-SRC": ["'self'"] },
      { "img-src": ["https://cdn.example:*"] }
    );
    expect(Object.keys(merged)).toEqual(["img-src"]);
    expect(merged["img-src"]).toContain("https://cdn.example:*");
  });
});

describe("cspHeaderValue", () => {
  it("renders directives a browser can parse", () => {
    const value = cspHeaderValue([
      { protocol: "https", hostname: "cdn.example" },
    ]);
    expect(value).toContain("img-src 'self' https://cdn.example:* data:");
    expect(value).toContain("object-src 'none'");
    expect(value.endsWith(";")).toBe(false);
  });

  it("round-trips through parse and serialize", () => {
    const value = "img-src 'self' data:; frame-src 'self'";
    expect(serializeCspDirectives(parseCspHeader(value))).toBe(value);
  });
});

describe("unmergeableStylePolicy", () => {
  it("names a directive whose nonce makes the inline allowance a no-op", () => {
    // CSP stops honouring `'unsafe-inline'` once a nonce or hash is present,
    // so merging into this policy would look successful and still block every
    // inline style the renderer emits.
    expect(
      unmergeableStylePolicy(parseCspHeader("style-src 'self' 'nonce-abc123'"))
    ).toBe("style-src");
    expect(
      unmergeableStylePolicy(parseCspHeader("style-src-elem 'sha256-Zm9vYmFy'"))
    ).toBe("style-src-elem");
  });

  it("says nothing about a policy the merge can serve", () => {
    expect(
      unmergeableStylePolicy(parseCspHeader("style-src 'self' 'unsafe-inline'"))
    ).toBeUndefined();
    // A nonce elsewhere is not this function's business: only the style
    // directives decide whether inline STYLES apply.
    expect(
      unmergeableStylePolicy(parseCspHeader("script-src 'nonce-abc123'"))
    ).toBeUndefined();
  });
});
