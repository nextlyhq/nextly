import { describe, expect, it } from "vitest";

import {
  cspDirectives,
  cspHeaderValue,
  mergeCspDirectives,
  parseCspHeader,
  serializeCspDirectives,
  unexpressibleHosts,
} from "./csp";

describe("cspDirectives", () => {
  it("allows this origin even with no patterns", () => {
    // The media library is same-origin and is what every refusal message points
    // an author at, so a policy that forbade it would refuse the remedy.
    const d = cspDirectives();
    expect(d["img-src"]).toContain("'self'");
    expect(d["frame-src"]).toEqual(["'self'"]);
  });

  it("carries a declared host into every fetch directive", () => {
    const d = cspDirectives([{ protocol: "https", hostname: "cdn.example" }]);
    for (const directive of [
      "img-src",
      "media-src",
      "frame-src",
      "font-src",
    ] as const) {
      expect(d[directive], directive).toContain("https://cdn.example");
    }
  });

  it("keeps the port a pattern names", () => {
    const d = cspDirectives([
      { protocol: "https", hostname: "cdn.example", port: "8443" },
    ]);
    expect(d["img-src"]).toContain("https://cdn.example:8443");
  });

  it("accepts a URL pattern, as the origin policy does", () => {
    const d = cspDirectives([new URL("https://cdn.example/img/a.png")]);
    expect(d["img-src"]).toContain("https://cdn.example");
  });

  it("omits the scheme when a pattern names no protocol", () => {
    // A pattern without one means either scheme; pinning it to https here
    // would refuse a host the origin policy allows.
    const d = cspDirectives([{ hostname: "cdn.example" }]);
    expect(d["img-src"]).toContain("cdn.example");
    expect(d["img-src"]).not.toContain("https://cdn.example");
  });

  it("keeps a hostname CSP can express exactly", () => {
    // A literal host, or one leading `*.` — the whole of the CSP host-source
    // grammar, and both mean in CSP what they mean in the origin policy.
    for (const hostname of ["cdn.example", "*.example.com"]) {
      expect(cspDirectives([{ hostname }])["img-src"], hostname).toContain(
        hostname
      );
    }
  });

  it("refuses a glob rather than widening it to a public suffix", () => {
    // The nearest expressible ancestor of `cdn-*.co.uk` is `*.co.uk`, which
    // allows every site under a public suffix — a CSP wider than the policy it
    // backstops, which is the one direction these must never differ in.
    // Identifying a public suffix needs a list this package has no business
    // shipping, so anything outside the CSP grammar is refused.
    for (const hostname of [
      "cdn-*.com",
      "cdn-*.co.uk",
      "**.example.com",
      "*",
      "",
    ]) {
      expect(cspDirectives([{ hostname }])["img-src"], hostname).toEqual([
        "'self'",
        "data:",
      ]);
    }
  });

  it("names the hosts it could not express", () => {
    // Refusing silently would leave the CSP blocking media the page is
    // configured to show, with nothing to point the host at.
    expect(
      unexpressibleHosts([
        { hostname: "cdn-*.com" },
        { hostname: "cdn.example" },
      ])
    ).toEqual(["cdn-*.com"]);
  });

  it("refuses a URL whose scheme the origin policy would reject", () => {
    // Dropping the scheme would emit a bare host, so the CSP would permit what
    // the parser refuses.
    expect(cspDirectives([new URL("ftp://cdn.example/a")])["img-src"]).toEqual([
      "'self'",
      "data:",
    ]);
  });

  it("refuses a port that is not a number", () => {
    // A port reaches the header as text. `443; script-src *` would close the
    // source and open a directive of the caller's choosing.
    for (const port of [
      "8443 https://evil.example",
      "443; script-src *",
      "x",
    ]) {
      expect(
        cspDirectives([{ hostname: "cdn.example", port }])["img-src"],
        port
      ).toEqual(["'self'", "data:"]);
    }
  });

  it("gives each directive its own array", () => {
    // Sharing one meant appending a frame origin silently widened `font-src`,
    // which is the edit someone makes while merging into an existing policy.
    const d = cspDirectives([{ hostname: "cdn.example" }]);
    d["frame-src"].push("https://player.example");
    expect(d["font-src"]).not.toContain("https://player.example");
  });

  it("allows data: images by default and blob: never by default", () => {
    // A data: URI carries its bytes and names no host, so it cannot be the
    // conditional request this exists to stop. A blob is script-created, so it
    // widens what a compromised script can show rather than what an author can
    // declare.
    const d = cspDirectives();
    expect(d["img-src"]).toContain("data:");
    expect(d["img-src"]).not.toContain("blob:");
    expect(d["media-src"]).not.toContain("data:");

    const opted = cspDirectives([], {
      allowDataImages: false,
      allowBlobMedia: true,
    });
    expect(opted["img-src"]).not.toContain("data:");
    expect(opted["img-src"]).toContain("blob:");
    expect(opted["media-src"]).toContain("blob:");
  });

  it("lists each host once however many patterns name it", () => {
    const d = cspDirectives([
      { protocol: "https", hostname: "cdn.example" },
      { protocol: "https", hostname: "cdn.example", pathname: "/img/**" },
    ]);
    expect(d["img-src"].filter(s => s === "https://cdn.example")).toHaveLength(
      1
    );
  });

  it("never emits script-src, which the host owns", () => {
    // A nonce-based script policy forces dynamic rendering on every page and
    // would defeat tag-based ISR. Scripts are the host application's business.
    expect(Object.keys(cspDirectives())).not.toContain("script-src");
  });
});

describe("cspHeaderValue", () => {
  it("renders directives a browser can parse", () => {
    const value = cspHeaderValue([
      { protocol: "https", hostname: "cdn.example" },
    ]);
    expect(value).toContain("img-src 'self' https://cdn.example data:");
    expect(value).toContain("frame-src 'self' https://cdn.example");
    // Semicolon-separated, no trailing separator.
    expect(value.split("; ")).toHaveLength(4);
    expect(value.endsWith(";")).toBe(false);
  });
});

describe("merging into an existing policy", () => {
  it("unions sources into the directive that already exists", () => {
    // Policies INTERSECT: an existing `img-src 'self'` refuses a CDN however
    // many other policies allow it. Nextly's own default headers send exactly
    // that, so sending this alongside would leave the feature not working.
    const existing = parseCspHeader("default-src 'self'; img-src 'self' data:");
    const merged = mergeCspDirectives(
      existing,
      cspDirectives([{ protocol: "https", hostname: "cdn.example" }])
    );
    expect(merged["img-src"]).toContain("https://cdn.example");
    expect(merged["img-src"]).toContain("'self'");
    // Directives the host had and this does not touch are preserved.
    expect(merged["default-src"]).toEqual(["'self'"]);
  });

  it("does not duplicate a source both policies name", () => {
    const merged = mergeCspDirectives(parseCspHeader("img-src 'self'"), {
      "img-src": ["'self'", "https://cdn.example"],
    });
    expect(merged["img-src"].filter(s => s === "'self'")).toHaveLength(1);
  });

  it("round-trips through parse and serialize", () => {
    const value = "img-src 'self' data:; frame-src 'self'";
    expect(serializeCspDirectives(parseCspHeader(value))).toBe(value);
  });
});
