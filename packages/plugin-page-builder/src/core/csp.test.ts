import { describe, expect, it } from "vitest";

import { cspDirectives, cspHeaderValue } from "./csp";

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

  it("widens a glob to the nearest host CSP can express", () => {
    // CSP host sources take one leading `*.` and nothing else, while patterns
    // are picomatch globs. Widening keeps the page working; dropping the host
    // would make the policy refuse media the site is configured to show, and a
    // policy that breaks the page is a policy someone removes.
    for (const [hostname, expected] of [
      ["**.example.com", "*.example.com"],
      ["cdn-*.example.com", "*.example.com"],
      ["*.example.com", "*.example.com"],
    ] as const) {
      expect(cspDirectives([{ hostname }])["img-src"], hostname).toContain(
        expected
      );
    }
  });

  it("drops a pattern with no expressible host rather than allowing everything", () => {
    // `*` matches every host. Widening THAT is not a restriction worth writing,
    // so it is left out and the origin policy remains the only thing allowing
    // it — a narrower CSP than the parser, never a wider one.
    const d = cspDirectives([{ hostname: "*" }, { hostname: "" }]);
    expect(d["img-src"]).toEqual(["'self'", "data:"]);
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
