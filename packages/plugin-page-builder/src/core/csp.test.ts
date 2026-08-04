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
  cspDirectives,
  cspHeaderValue,
  mergeCspDirectives,
  parseCspHeader,
  serializeCspDirectives,
  unexpressibleHosts,
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

  it("expresses a prefix pathname, which CSP writes with a trailing slash", () => {
    const d = cspDirectives([
      { protocol: "https", hostname: "cdn.example", pathname: "/img/**" },
    ]);
    expect(d["img-src"]).toContain("https://cdn.example:*/img/");
  });

  it("carries a host into every fetch directive", () => {
    const d = cspDirectives([{ protocol: "https", hostname: "cdn.example" }]);
    for (const name of [
      "img-src",
      "media-src",
      "frame-src",
      "font-src",
    ] as const)
      expect(d[name], name).toContain("https://cdn.example:*");
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

  it("refuses an omitted protocol, which the two read differently", () => {
    // Either scheme to the matcher; the document's own scheme to CSP.
    expect(refused({ hostname: "cdn.example" })).toEqual(SELF_ONLY);
  });

  it("refuses an explicit port, which the matcher can never match", () => {
    // The URL parser canonicalises a default port away before the matcher
    // compares it, so `port: "443"` on https matches nothing — and emitting it
    // would allow an origin the pattern forbids.
    for (const port of ["443", "8443", "0443"])
      expect(
        refused({ protocol: "https", hostname: "cdn.example", port }),
        port
      ).toEqual(SELF_ONLY);
  });

  it("refuses a glob CSP cannot express, rather than widening it", () => {
    // Widening `cdn-*.co.uk` to `*.co.uk` allows every site under a public
    // suffix, and telling a public suffix apart needs a list this package has
    // no business shipping.
    for (const hostname of [
      "cdn-*.com",
      "cdn-*.co.uk",
      "**.example.com",
      "*",
      "",
    ])
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

  it("refuses a single-segment path glob, which CSP cannot bound", () => {
    expect(
      refused({
        protocol: "https",
        hostname: "cdn.example",
        pathname: "/img/*",
      })
    ).toEqual(SELF_ONLY);
  });

  it("refuses a search constraint, which CSP does not match at all", () => {
    expect(
      refused({ protocol: "https", hostname: "cdn.example", search: "?v=1" })
    ).toEqual(SELF_ONLY);
  });

  it("refuses a non-https URL and a URL carrying a path", () => {
    expect(cspDirectives([new URL("ftp://cdn.example/a")])["img-src"]).toEqual(
      SELF_ONLY
    );
    expect(
      cspDirectives([new URL("https://cdn.example/img/a.png")])["img-src"]
    ).toEqual(SELF_ONLY);
    // A bare https origin does translate.
    expect(
      cspDirectives([new URL("https://cdn.example")])["img-src"]
    ).toContain("https://cdn.example:*");
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
