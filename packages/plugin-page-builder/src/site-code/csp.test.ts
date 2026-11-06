/**
 * Site code against a Content Security Policy, read by CSP Level 3's rules:
 * which directive judges what, how hashes, nonces and `'strict-dynamic'`
 * change what inline code may run, how host sources match, and that adding
 * what site code needs never widens what the policy allows otherwise.
 *
 * @module site-code/csp.test
 */
import { describe, expect, it } from "vitest";

import {
  checkSiteCodeAgainstCsp,
  cspHash,
  mergeSiteCodeIntoCsp,
  parseCsp,
  siteCodeFacts,
  type CspCheckInput,
} from "./csp";
import type { SiteCodeEntry } from "./rules";

const ORIGIN = "https://acme.example";
const GTAG = "https://www.googletagmanager.com/gtag/js?id=G-TEST123";

const inline = (text: string): SiteCodeEntry => ({
  tag: "script",
  attrs: {},
  text,
});
const loaded = (
  src: string,
  more: Record<string, string> = {}
): SiteCodeEntry => ({ tag: "script", attrs: { src, ...more } });
const style = (text: string): SiteCodeEntry => ({
  tag: "style",
  attrs: {},
  text,
});
const pixel = (tag: "img" | "iframe", src: string): SiteCodeEntry => ({
  tag: "noscript",
  child: { tag, attrs: { src } },
});

/** The directives that would block `head` and `body` under `policy`. */
async function blockedBy(
  policy: string,
  head: readonly SiteCodeEntry[],
  body: readonly SiteCodeEntry[] = [],
  extra: Partial<CspCheckInput> = {}
): Promise<string[]> {
  const check = await checkSiteCodeAgainstCsp(
    { policy, siteOrigin: ORIGIN, ...extra },
    { head, body }
  );
  if (!check.checked) throw new Error(check.reason);
  return check.findings.map(finding => finding.directive);
}

describe("reading a policy", () => {
  it("hashes inline text as CSP does: SHA-256 of its UTF-8, base64", async () => {
    expect(await cspHash("")).toBe(
      "sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU="
    );
  });

  it("reads directive names in any case, keeping the first of a repeat", () => {
    const policy = parseCsp(
      "Script-Src 'self'; script-src https://x.example; ; img-src *"
    );
    expect(policy.get("script-src")).toEqual(["'self'"]);
    expect([...policy.keys()]).toEqual(["script-src", "img-src"]);
  });

  it("says nothing was checked when no policy is known", async () => {
    const check = await checkSiteCodeAgainstCsp(
      { siteOrigin: ORIGIN },
      { head: [inline("a()")], body: [] }
    );
    expect(check).toEqual({
      checked: false,
      reason:
        "No Content Security Policy is known for this site; nothing was checked.",
    });
  });
});

describe("inline code", () => {
  it("is blocked where the policy allows only sources", async () => {
    expect(await blockedBy("script-src 'self'", [inline("a()")])).toEqual([
      "script-src",
    ]);
  });

  it("runs under 'unsafe-inline' alone", async () => {
    expect(
      await blockedBy("script-src 'unsafe-inline'", [inline("a()")])
    ).toEqual([]);
  });

  it("is blocked when a hash in the list cancels 'unsafe-inline'", async () => {
    expect(
      await blockedBy("script-src 'unsafe-inline' 'sha256-AAAA'", [
        inline("a()"),
      ])
    ).toEqual(["script-src"]);
  });

  it("runs when the list names its hash", async () => {
    const hash = await cspHash("a()");
    expect(
      await blockedBy(`script-src 'self' '${hash}'`, [inline("a()")])
    ).toEqual([]);
  });

  it("runs under a nonce only where the site passes it the nonce", async () => {
    const policy = "script-src 'nonce-abc'";
    expect(
      await blockedBy(policy, [inline("a()")], [], { siteNonce: true })
    ).toEqual([]);
    expect(await blockedBy(policy, [inline("a()")])).toEqual(["script-src"]);
  });

  it("is blocked when 'strict-dynamic' cancels 'unsafe-inline'", async () => {
    expect(
      await blockedBy("script-src 'strict-dynamic' 'unsafe-inline'", [
        inline("a()"),
      ])
    ).toEqual(["script-src"]);
  });

  it("is judged by the most specific directive, then its fallbacks", async () => {
    expect(await blockedBy("default-src 'self'", [inline("a()")])).toEqual([
      "default-src",
    ]);
    expect(
      await blockedBy("script-src-elem 'self'; script-src 'unsafe-inline'", [
        inline("a()"),
      ])
    ).toEqual(["script-src-elem"]);
  });

  it("never judges structured data, which is not run", async () => {
    expect(
      await blockedBy("script-src 'self'", [
        {
          tag: "script",
          attrs: { type: "application/ld+json" },
          text: "{}",
        },
      ])
    ).toEqual([]);
  });

  it("judges inline styles by style-src, not script-src", async () => {
    expect(
      await blockedBy("script-src 'self'; style-src 'self'", [
        style(".a{color:red}"),
      ])
    ).toEqual(["style-src"]);
  });
});

describe("what site code loads", () => {
  it("is allowed from a host the list names, and blocked otherwise", async () => {
    expect(
      await blockedBy("script-src https://www.googletagmanager.com", [
        loaded(GTAG),
      ])
    ).toEqual([]);
    const check = await checkSiteCodeAgainstCsp(
      { policy: "script-src 'self'", siteOrigin: ORIGIN },
      { head: [loaded(GTAG)], body: [] }
    );
    expect(check).toMatchObject({
      checked: true,
      findings: [
        {
          slot: "head",
          index: 0,
          directive: "script-src",
          level: "error",
          message: "https://www.googletagmanager.com is blocked for scripts",
        },
      ],
    });
  });

  it("matches a wildcard host's subdomains, in any case, not the host itself", async () => {
    const policy = "script-src *.GoogleTagManager.com";
    expect(
      await blockedBy(policy, [loaded("https://www.googletagmanager.com/a.js")])
    ).toEqual([]);
    expect(
      await blockedBy(policy, [loaded("https://googletagmanager.com/a.js")])
    ).toEqual(["script-src"]);
  });

  it("matches a path as a directory or an exact file", async () => {
    expect(
      await blockedBy("script-src https://cdn.example/lib/", [
        loaded("https://cdn.example/lib/a.js"),
        loaded("https://cdn.example/other.js"),
      ])
    ).toEqual(["script-src"]);
    expect(
      await blockedBy("script-src https://cdn.example/a.js", [
        loaded("https://cdn.example/a.js"),
        loaded("https://cdn.example/a.js.map"),
      ])
    ).toEqual(["script-src"]);
  });

  it("matches a port only where the source names it", async () => {
    const odd = loaded("https://cdn.example:8443/a.js");
    expect(await blockedBy("script-src https://cdn.example", [odd])).toEqual([
      "script-src",
    ]);
    expect(await blockedBy("script-src https://cdn.example:*", [odd])).toEqual(
      []
    );
  });

  it("reads a site path as the site's own origin, which 'self' allows", async () => {
    expect(await blockedBy("script-src 'self'", [loaded("/js/a.js")])).toEqual(
      []
    );
  });

  it("allows any https: address under a scheme source", async () => {
    expect(await blockedBy("script-src https:", [loaded(GTAG)])).toEqual([]);
  });

  it("ignores host sources under 'strict-dynamic'", async () => {
    const policy =
      "script-src 'strict-dynamic' 'nonce-abc' https://www.googletagmanager.com";
    expect(await blockedBy(policy, [loaded(GTAG)])).toEqual(["script-src"]);
    expect(
      await blockedBy(policy, [loaded(GTAG)], [], { siteNonce: true })
    ).toEqual([]);
    expect(
      await blockedBy("script-src 'strict-dynamic' 'sha384-abc'", [
        loaded(GTAG, { integrity: "sha384-abc" }),
      ])
    ).toEqual([]);
  });

  it("judges a no-script pixel as an image and a frame by its fallback", async () => {
    expect(
      await blockedBy(
        "img-src 'self'",
        [],
        [pixel("img", "https://www.facebook.com/tr?id=1")]
      )
    ).toEqual(["img-src"]);
    expect(
      await blockedBy(
        "child-src 'self'",
        [],
        [pixel("iframe", "https://www.googletagmanager.com/ns.html")]
      )
    ).toEqual(["child-src"]);
  });

  it("reads a stylesheet's imports, fonts and images", async () => {
    expect(
      await blockedBy(
        "style-src 'unsafe-inline'; font-src 'self'; img-src 'self'",
        [
          style(
            "@import url(https://fonts.example/a.css); @font-face{font-family:x;src:url(https://fonts.gstatic.com/x.woff2)} .a{background:url(https://img.example/b.png)}"
          ),
        ]
      )
    ).toEqual(["style-src", "font-src", "img-src"]);
  });

  it("reads a stylesheet link as a style and a preconnect as nothing", async () => {
    expect(
      await blockedBy("style-src 'self'", [
        {
          tag: "link",
          attrs: {
            rel: "stylesheet",
            href: "https://fonts.googleapis.com/css",
          },
        },
        {
          tag: "link",
          attrs: { rel: "preconnect", href: "https://fonts.gstatic.com" },
        },
      ])
    ).toEqual(["style-src"]);
  });

  it("warns rather than errs under a Report-Only policy", async () => {
    const check = await checkSiteCodeAgainstCsp(
      { policy: "script-src 'self'", reportOnly: true, siteOrigin: ORIGIN },
      { head: [inline("a()")], body: [] }
    );
    expect(check).toMatchObject({
      checked: true,
      findings: [{ level: "warning" }],
    });
  });
});

describe("what site code needs of a policy", () => {
  it("hashes inline code and names each other origin once", async () => {
    const facts = await siteCodeFacts(
      [
        inline("a()"),
        loaded(GTAG),
        loaded("https://www.googletagmanager.com/other.js"),
        loaded("/js/own.js"),
        loaded(`${ORIGIN}/js/own.js`),
        { tag: "script", attrs: { type: "application/ld+json" }, text: "{}" },
      ],
      ORIGIN
    );
    expect(facts.scriptHashes).toEqual([await cspHash("a()")]);
    expect(facts.origins.script).toEqual(["https://www.googletagmanager.com"]);
  });
});

describe("adding what site code needs to a policy", () => {
  /** The facts of the Google tag: its inline setup, and its loaded script. */
  async function gtagFacts() {
    const facts = await siteCodeFacts([inline("a()"), loaded(GTAG)], ORIGIN);
    return { facts, hash: `'${await cspHash("a()")}'` };
  }
  const GTM = "https://www.googletagmanager.com";

  it("adds the hash and origin to a policy that relies on hashes", async () => {
    const { facts, hash } = await gtagFacts();
    expect(mergeSiteCodeIntoCsp("script-src 'self' 'sha256-AAAA'", facts)).toBe(
      `script-src 'self' 'sha256-AAAA' ${hash} ${GTM}`
    );
  });

  it("never adds a hash that would cancel 'unsafe-inline'", async () => {
    const { facts } = await gtagFacts();
    expect(
      mergeSiteCodeIntoCsp("script-src 'self' 'unsafe-inline'", facts)
    ).toBe(`script-src 'self' 'unsafe-inline' ${GTM}`);
  });

  it("leaves a nonce-based, 'strict-dynamic' policy as it is", async () => {
    const { facts } = await gtagFacts();
    const policy = "script-src 'nonce-abc' 'strict-dynamic'";
    expect(mergeSiteCodeIntoCsp(policy, facts)).toBe(policy);
  });

  it("adds to a directive of the kind's own, never widening default-src", async () => {
    const { facts, hash } = await gtagFacts();
    expect(mergeSiteCodeIntoCsp("default-src 'self'; img-src *", facts)).toBe(
      `default-src 'self'; img-src *; script-src 'self' ${hash} ${GTM}`
    );
    expect(mergeSiteCodeIntoCsp("default-src 'none'", facts)).toBe(
      `default-src 'none'; script-src ${hash} ${GTM}`
    );
  });

  it("adds a frame's origin to frame-src, not the child-src it fell back to", async () => {
    const facts = await siteCodeFacts(
      [pixel("iframe", "https://www.googletagmanager.com/ns.html")],
      ORIGIN
    );
    expect(mergeSiteCodeIntoCsp("child-src 'self'", facts)).toBe(
      `child-src 'self'; frame-src 'self' ${GTM}`
    );
  });

  it("leaves a kind no directive restricts alone", async () => {
    const { facts } = await gtagFacts();
    expect(mergeSiteCodeIntoCsp("img-src 'self'", facts)).toBe(
      "img-src 'self'"
    );
  });

  it("is the same added twice, and lets the site code run", async () => {
    const { facts } = await gtagFacts();
    const once = mergeSiteCodeIntoCsp("default-src 'self'", facts);
    expect(mergeSiteCodeIntoCsp(once, facts)).toBe(once);
    expect(await blockedBy(once, [inline("a()"), loaded(GTAG)])).toEqual([]);
  });
});
