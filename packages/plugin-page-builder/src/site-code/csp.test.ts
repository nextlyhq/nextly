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
  type CspCheck,
  type CspCheckInput,
  type CspFinding,
} from "./csp";
import { SITE_CODE_BOOTSTRAP } from "./bootstrap";
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
const pixel = (
  tag: "img" | "iframe",
  src: string,
  more: Record<string, string> = {}
): SiteCodeEntry => ({
  tag: "noscript",
  child: { tag, attrs: { src, ...more } },
});

/** Whether a finding is about the loader that starts gated code. */
const aboutLoader = (message: string): boolean =>
  message.startsWith("the loader");

/** A check's findings about the entries themselves, the loader's left out. */
function entryFindingsOf(check: CspCheck): CspFinding[] {
  if (!check.checked) throw new Error(check.reason);
  return check.findings.filter(finding => !aboutLoader(finding.message));
}

/** The loader's hash, as a policy names it. */
const loaderHash = async (): Promise<string> =>
  `'${await cspHash(SITE_CODE_BOOTSTRAP)}'`;

/**
 * The directives that would block `head` and `body` under `policy`, each
 * entry's own: the loader's block is asserted on its own below.
 */
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
  return check.findings
    .filter(finding => !aboutLoader(finding.message))
    .map(finding => finding.directive);
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
    expect(entryFindingsOf(check)).toEqual([
      {
        slot: "head",
        index: 0,
        directive: "script-src",
        level: "error",
        message: "https://www.googletagmanager.com is blocked for scripts",
      },
    ]);
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
    // Which entry is blocked, not only that one is: the second each time.
    const blockedIndexes = async (policy: string, urls: string[]) => {
      const check = await checkSiteCodeAgainstCsp(
        { policy, siteOrigin: ORIGIN },
        { head: urls.map(url => loaded(url)), body: [] }
      );
      return entryFindingsOf(check).map(finding => finding.index);
    };
    expect(
      await blockedIndexes("script-src https://cdn.example/lib/", [
        "https://cdn.example/lib/a.js",
        "https://cdn.example/other.js",
      ])
    ).toEqual([1]);
    expect(
      await blockedIndexes("script-src https://cdn.example/a.js", [
        "https://cdn.example/a.js",
        "https://cdn.example/a.js.map",
      ])
    ).toEqual([1]);
  });

  it("compares path segments percent-decoded", async () => {
    expect(
      await blockedBy("script-src https://cdn.example/a%2Eb.js", [
        loaded("https://cdn.example/a.b.js"),
      ])
    ).toEqual([]);
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

  it("reads an import written as a plain string, and no condition after it", async () => {
    expect(
      await blockedBy("style-src 'unsafe-inline'", [
        style('@import "https://fonts.example/a.css";'),
      ])
    ).toEqual(["style-src"]);
    expect(
      await blockedBy("style-src 'unsafe-inline' https://fonts.example", [
        style(
          '@import url(https://fonts.example/a.css) supports(font-family: "x");'
        ),
      ])
    ).toEqual([]);
  });

  it("judges a manifest by manifest-src, then default-src", async () => {
    const manifest: SiteCodeEntry = {
      tag: "link",
      attrs: { rel: "manifest", href: "https://pwa.example/app.webmanifest" },
    };
    expect(await blockedBy("manifest-src 'self'", [manifest])).toEqual([
      "manifest-src",
    ]);
    expect(await blockedBy("default-src 'self'", [manifest])).toEqual([
      "default-src",
    ]);
  });

  it("lets a loaded script the site passes its nonce to run without 'strict-dynamic'", async () => {
    const policy = "script-src 'nonce-abc'";
    expect(
      await blockedBy(policy, [loaded(GTAG)], [], { siteNonce: true })
    ).toEqual([]);
    expect(await blockedBy(policy, [loaded(GTAG)])).toEqual(["script-src"]);
  });

  it("needs every hash a script's integrity holds", async () => {
    const both = loaded(GTAG, { integrity: "sha256-aaa sha384-bbb" });
    expect(
      await blockedBy("script-src 'strict-dynamic' 'sha256-aaa'", [both])
    ).toEqual(["script-src"]);
    expect(
      await blockedBy("script-src 'strict-dynamic' 'sha256-aaa' 'sha384-bbb'", [
        both,
      ])
    ).toEqual([]);
    // Integrity alone lets a script load where no host is named.
    expect(
      await blockedBy("script-src 'sha384-bbb'", [
        loaded(GTAG, { integrity: "sha384-bbb" }),
      ])
    ).toEqual([]);
  });

  it("judges a pixel's style attribute, which applies with scripting off", async () => {
    const hidden = pixel("img", "/p.gif", { style: "display:none" });
    expect(await blockedBy("style-src 'self'", [], [hidden])).toEqual([
      "style-src",
    ]);
    expect(
      await blockedBy("style-src 'self' 'unsafe-inline'", [], [hidden])
    ).toEqual([]);
  });

  it("ignores 'none' beside other sources, as browsers do", async () => {
    expect(
      await blockedBy("script-src 'none' https://cdn.example", [
        loaded("https://cdn.example/a.js"),
      ])
    ).toEqual([]);
    expect(
      await blockedBy("script-src 'none'", [loaded("https://cdn.example/a.js")])
    ).toEqual(["script-src"]);
  });

  it("matches no URL whose host is an IP address, by any host source", async () => {
    // A host source needs a domain; the bare `*` keyword is no host source.
    for (const policy of [
      "script-src https://203.0.113.5",
      "script-src https://127.0.0.1",
      "script-src https://*",
    ]) {
      const ip = policy.includes("127.0.0.1") ? "127.0.0.1" : "203.0.113.5";
      expect(await blockedBy(policy, [loaded(`https://${ip}/a.js`)])).toEqual([
        "script-src",
      ]);
    }
  });

  it("takes no malformed nonce or hash for one, so 'unsafe-inline' stands", async () => {
    expect(
      await blockedBy(
        "script-src 'unsafe-inline' 'nonce-'",
        [inline("a()")],
        [],
        { siteNonce: true }
      )
    ).toEqual([]);
    expect(
      await blockedBy("script-src 'unsafe-inline' 'sha256-'", [inline("a()")])
    ).toEqual([]);
  });

  it("allows by nonce only where each policy names the element's one nonce", async () => {
    const twoPolicies = "script-src 'nonce-a', script-src 'nonce-b'";
    expect(
      await blockedBy(twoPolicies, [inline("x()")], [], { siteNonce: "a" })
    ).toEqual(["script-src"]);
    expect(
      await blockedBy(twoPolicies, [inline("x()")], [], { siteNonce: true })
    ).toEqual(["script-src"]);
    expect(
      await blockedBy("script-src 'nonce-a'", [inline("x()")], [], {
        siteNonce: "b",
      })
    ).toEqual(["script-src"]);
  });

  it("judges a connection hint by every fetch directive at once", async () => {
    const hint: SiteCodeEntry = {
      tag: "link",
      attrs: { rel: "preconnect", href: "https://api.example" },
    };
    expect(await blockedBy("default-src 'none'", [hint])).toEqual([
      "default-src",
    ]);
    expect(
      await blockedBy("default-src 'none'; connect-src https://api.example", [
        hint,
      ])
    ).toEqual([]);
    // A policy with no fetch directive restricts no connection.
    expect(await blockedBy("frame-ancestors 'none'", [hint])).toEqual([]);
  });

  it("judges what a pixel's style attribute fetches", async () => {
    expect(
      await blockedBy(
        "img-src 'self'",
        [],
        [
          pixel("img", "/p.gif", {
            style: "background:url(https://t.example/p.png)",
          }),
        ]
      )
    ).toEqual(["img-src"]);
  });

  it("never lets the site's nonce stand for a stylesheet's import", async () => {
    expect(
      await blockedBy(
        "style-src 'nonce-x'",
        [style('@import "https://fonts.example/a.css";')],
        [],
        { siteNonce: true }
      )
    ).toEqual(["style-src"]);
  });

  it("checks every policy a header carries", async () => {
    expect(
      await blockedBy("script-src https://cdn.example, script-src 'none'", [
        loaded("https://cdn.example/a.js"),
      ])
    ).toEqual(["script-src"]);
  });

  it("lets 'self' allow the site's secure upgrade", async () => {
    const check = await checkSiteCodeAgainstCsp(
      { policy: "script-src 'self'", siteOrigin: "http://acme.example" },
      { head: [loaded("https://acme.example/a.js")], body: [] }
    );
    expect(entryFindingsOf(check)).toEqual([]);
  });

  it("matches a hash in any algorithm case and in base64url", async () => {
    const digest = (await cspHash("a()")).slice("sha256-".length);
    const variant = `SHA256-${digest.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
    expect(await blockedBy(`script-src '${variant}'`, [inline("a()")])).toEqual(
      []
    );
  });

  it("reads a link's relation in any case", async () => {
    expect(
      await blockedBy("style-src 'self'", [
        {
          tag: "link",
          attrs: { rel: "STYLESHEET", href: "https://cdn.example/a.css" },
        },
      ])
    ).toEqual(["style-src"]);
  });

  it("reports the loader blocked once, on the first entry it starts", async () => {
    const check = await checkSiteCodeAgainstCsp(
      { policy: "script-src 'self'", siteOrigin: ORIGIN },
      {
        head: [
          { tag: "meta", attrs: { name: "a", content: "b" } },
          inline("a()"),
          inline("b()"),
        ],
        body: [],
      }
    );
    if (!check.checked) throw new Error(check.reason);
    const loader = check.findings.filter(finding =>
      aboutLoader(finding.message)
    );
    expect(loader).toEqual([
      expect.objectContaining({
        slot: "head",
        index: 1,
        directive: "script-src",
      }),
    ]);
    expect(loader[0]?.message).toContain(await loaderHash());
  });

  it("lets the loader run under 'unsafe-inline', its hash or the site's nonce", async () => {
    const runs = async (policy: string, siteNonce = false) => {
      const check = await checkSiteCodeAgainstCsp(
        { policy, siteOrigin: ORIGIN, siteNonce },
        { head: [inline("a()")], body: [] }
      );
      if (!check.checked) throw new Error(check.reason);
      return !check.findings.some(finding => aboutLoader(finding.message));
    };
    expect(await runs("script-src 'unsafe-inline'")).toBe(true);
    expect(await runs(`script-src ${await loaderHash()}`)).toBe(true);
    expect(await runs("script-src 'nonce-x'", true)).toBe(true);
    expect(await runs("script-src 'nonce-x'")).toBe(false);
  });

  it("says nothing of the loader for code it doesn't start", async () => {
    const check = await checkSiteCodeAgainstCsp(
      { policy: "script-src 'self'; img-src *", siteOrigin: ORIGIN },
      { head: [], body: [pixel("img", "https://t.example/p.gif")] }
    );
    expect(check).toEqual({ checked: true, findings: [] });
  });

  it("warns rather than errs under a Report-Only policy", async () => {
    const check = await checkSiteCodeAgainstCsp(
      { policy: "script-src 'self'", reportOnly: true, siteOrigin: ORIGIN },
      { head: [inline("a()")], body: [] }
    );
    // The inline script's block and the loader's, each only a warning.
    if (!check.checked) throw new Error(check.reason);
    expect(check.findings.map(finding => finding.level)).toEqual([
      "warning",
      "warning",
    ]);
  });
});

describe("what site code needs of a policy", () => {
  it("hashes inline code and keeps each load once, its own site's too", async () => {
    const facts = await siteCodeFacts(
      [
        inline("a()"),
        inline("a()"),
        loaded(GTAG),
        loaded(GTAG),
        loaded("/js/own.js"),
        { tag: "script", attrs: { type: "application/ld+json" }, text: "{}" },
      ],
      ORIGIN
    );
    // The inline script's hash, then the loader's, which starts it.
    expect(facts.hashes.script).toEqual([
      await cspHash("a()"),
      await cspHash(SITE_CODE_BOOTSTRAP),
    ]);
    expect(facts.loads).toEqual([
      { kind: "script", url: GTAG },
      { kind: "script", url: "/js/own.js" },
    ]);
  });
});

describe("adding what site code needs to a policy", () => {
  /** The facts of the Google tag: its inline setup, and its loaded script. */
  async function gtagFacts() {
    const facts = await siteCodeFacts([inline("a()"), loaded(GTAG)], ORIGIN);
    return { facts, hash: `'${await cspHash("a()")}'` };
  }
  const GTM = "https://www.googletagmanager.com";

  it("adds the hash and origin to script-src-elem, never to script-src, which workers fall back to", async () => {
    const { facts, hash } = await gtagFacts();
    expect(mergeSiteCodeIntoCsp("script-src 'self' 'sha256-AAAA'", facts)).toBe(
      `script-src 'self' 'sha256-AAAA'; script-src-elem 'self' 'sha256-AAAA' ${hash} ${await loaderHash()} ${GTM}/gtag/js`
    );
  });

  it("never adds a hash that would cancel 'unsafe-inline'", async () => {
    const { facts } = await gtagFacts();
    expect(
      mergeSiteCodeIntoCsp("script-src 'self' 'unsafe-inline'", facts)
    ).toBe(
      `script-src 'self' 'unsafe-inline'; script-src-elem 'self' 'unsafe-inline' ${GTM}/gtag/js`
    );
  });

  it("leaves a nonce-based, 'strict-dynamic' policy as it is where the site passes its nonce", async () => {
    const { facts, hash } = await gtagFacts();
    const policy = "script-src 'nonce-abc' 'strict-dynamic'";
    expect(mergeSiteCodeIntoCsp(policy, facts, { siteNonce: true })).toBe(
      policy
    );
    // Without the nonce, the inline setup needs its hash; no host is
    // honoured under 'strict-dynamic', so none is added for the script.
    expect(mergeSiteCodeIntoCsp(policy, facts)).toBe(
      `${policy}; script-src-elem 'nonce-abc' 'strict-dynamic' ${hash} ${await loaderHash()}`
    );
  });

  it("adds nothing for a load a path-scoped source already allows", async () => {
    const facts = await siteCodeFacts(
      [loaded("https://cdn.example/approved/a.js")],
      ORIGIN
    );
    const policy = "script-src https://cdn.example/approved/";
    // Only the loader's hash is added: the script's own load already passes.
    expect(mergeSiteCodeIntoCsp(policy, facts)).toBe(
      `${policy}; script-src-elem https://cdn.example/approved/ ${await loaderHash()}`
    );
  });

  it("adds the one URL a blocked load needs, never its whole host", async () => {
    const facts = await siteCodeFacts([loaded("/analytics.js")], ORIGIN);
    const merged = mergeSiteCodeIntoCsp("default-src 'none'", facts);
    expect(merged).toBe(
      `default-src 'none'; script-src-elem ${await loaderHash()} ${ORIGIN}/analytics.js`
    );
    expect(await blockedBy(merged, [loaded("/analytics.js")])).toEqual([]);
  });

  it("adds a script's integrity hashes under 'strict-dynamic'", async () => {
    const facts = await siteCodeFacts(
      [loaded(GTAG, { integrity: "sha384-abc" })],
      ORIGIN
    );
    expect(
      mergeSiteCodeIntoCsp("script-src 'strict-dynamic' 'nonce-x'", facts)
    ).toBe(
      `script-src 'strict-dynamic' 'nonce-x'; script-src-elem 'strict-dynamic' 'nonce-x' ${await loaderHash()} 'sha384-abc'`
    );
  });

  it("lets a pixel's style attribute through by its hash alone", async () => {
    const facts = await siteCodeFacts(
      [pixel("img", "/p.gif", { style: "display:none" })],
      ORIGIN
    );
    const hash = await cspHash("display:none");
    const merged = mergeSiteCodeIntoCsp(
      "style-src 'self'; img-src 'self'",
      facts
    );
    expect(merged).toBe(
      `style-src 'self'; img-src 'self'; style-src-attr 'self' 'unsafe-hashes' '${hash}'`
    );
    expect(
      await blockedBy(
        merged,
        [],
        [pixel("img", "/p.gif", { style: "display:none" })]
      )
    ).toEqual([]);
  });

  it("adds to a directive of the kind's own, never widening default-src", async () => {
    const { facts, hash } = await gtagFacts();
    expect(mergeSiteCodeIntoCsp("default-src 'self'; img-src *", facts)).toBe(
      `default-src 'self'; img-src *; script-src-elem 'self' ${hash} ${await loaderHash()} ${GTM}/gtag/js`
    );
    expect(mergeSiteCodeIntoCsp("default-src 'none'", facts)).toBe(
      `default-src 'none'; script-src-elem ${hash} ${await loaderHash()} ${GTM}/gtag/js`
    );
  });

  it("gives each policy a header carries what it blocks", async () => {
    const facts = await siteCodeFacts(
      [loaded("https://cdn.example/a.js")],
      ORIGIN
    );
    expect(
      mergeSiteCodeIntoCsp(
        "script-src https://cdn.example, script-src 'none'",
        facts
      )
    ).toBe(
      `script-src https://cdn.example; script-src-elem https://cdn.example ${await loaderHash()}, script-src 'none'; script-src-elem ${await loaderHash()} https://cdn.example/a.js`
    );
  });

  it("adds nothing for a hash the policy names in another spelling", async () => {
    const facts = await siteCodeFacts([inline("a()")], ORIGIN);
    const digest = (await cspHash("a()")).slice("sha256-".length);
    const variant = `SHA256-${digest.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
    const policy = `script-src '${variant}'`;
    // The code's own hash is named already; only the loader's is added.
    expect(mergeSiteCodeIntoCsp(policy, facts)).toBe(
      `${policy}; script-src-elem '${variant}' ${await loaderHash()}`
    );
  });

  it("keeps a stylesheet imported and linked as two loads, the import unnonced", async () => {
    const facts = await siteCodeFacts(
      [
        style('@import "https://fonts.example/a.css";'),
        {
          tag: "link",
          attrs: { rel: "stylesheet", href: "https://fonts.example/a.css" },
        },
      ],
      ORIGIN
    );
    // The link runs by the nonce; the import needs its URL all the same.
    expect(
      mergeSiteCodeIntoCsp("style-src 'nonce-x'", facts, { siteNonce: true })
    ).toBe(
      "style-src 'nonce-x'; style-src-elem 'nonce-x' https://fonts.example/a.css"
    );
  });

  it("never widens a policy for a connection hint", async () => {
    const facts = await siteCodeFacts(
      [
        {
          tag: "link",
          attrs: { rel: "preconnect", href: "https://api.example" },
        },
      ],
      ORIGIN
    );
    expect(mergeSiteCodeIntoCsp("default-src 'none'", facts)).toBe(
      "default-src 'none'"
    );
  });

  it("adds a frame's origin to frame-src, not the child-src it fell back to", async () => {
    const facts = await siteCodeFacts(
      [pixel("iframe", "https://www.googletagmanager.com/ns.html")],
      ORIGIN
    );
    expect(mergeSiteCodeIntoCsp("child-src 'self'", facts)).toBe(
      `child-src 'self'; frame-src 'self' ${GTM}/ns.html`
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
