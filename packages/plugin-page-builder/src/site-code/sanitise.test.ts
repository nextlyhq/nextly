/**
 * Pasted site code, judged as a browser would build it: the vendor snippets
 * people paste are stored as entries, and each way code hides in markup that
 * does not look like a script, or breaks out of its slot, is refused with a
 * reason, never stripped.
 *
 * @module site-code/sanitise.test
 */
import { describe, expect, it } from "vitest";

import { SITE_CODE_LIMITS, siteCodeEntryProblem } from "./rules";
import { normaliseSiteCodeText, sanitiseSiteCode } from "./sanitise";

/** The refusals pasting `html` into `slot` comes to; none when it is stored. */
function refusalsOf(html: string, slot: "head" | "body" = "head"): string[] {
  return [...sanitiseSiteCode(html, slot).refusals];
}

describe("vendor snippets", () => {
  it("stores the Google tag as a loaded script and its inline setup", () => {
    const { entries, refusals } = sanitiseSiteCode(
      `<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-TEST123"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-TEST123');
</script>`,
      "head"
    );
    expect(refusals).toEqual([]);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      tag: "script",
      attrs: {
        async: "",
        src: "https://www.googletagmanager.com/gtag/js?id=G-TEST123",
      },
    });
    const setup = entries[1];
    expect(setup?.tag === "script" ? setup.text : undefined).toContain(
      "gtag('config', 'G-TEST123');"
    );
  });

  it("stores Tag Manager's no-script frame at the end of the body", () => {
    const { entries, refusals } = sanitiseSiteCode(
      `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-TEST" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`,
      "body"
    );
    expect(refusals).toEqual([]);
    expect(entries).toEqual([
      {
        tag: "noscript",
        child: {
          tag: "iframe",
          attrs: {
            src: "https://www.googletagmanager.com/ns.html?id=GTM-TEST",
            height: "0",
            width: "0",
            style: "display:none;visibility:hidden",
          },
        },
      },
    ]);
  });

  it("stores the Meta pixel's hidden image in the body", () => {
    expect(
      refusalsOf(
        `<noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=1&ev=PageView&noscript=1"/></noscript>`,
        "body"
      )
    ).toEqual([]);
  });

  it("stores structured data, a verification tag and a preconnect", () => {
    const { entries, refusals } = sanitiseSiteCode(
      `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Acme"}</script>
<meta name="google-site-verification" content="abc123">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>`,
      "head"
    );
    expect(refusals).toEqual([]);
    expect(entries.map(entry => entry.tag)).toEqual(["script", "meta", "link"]);
  });

  it("stores an inline script as it is: running code is the point", () => {
    expect(refusalsOf("<script>alert(1)</script>")).toEqual([]);
  });

  it("drops comments and says so", () => {
    const { notes, entries } = sanitiseSiteCode(
      "<!-- one --><script>a()</script><!-- two -->",
      "head"
    );
    expect(entries).toHaveLength(1);
    expect(notes).toEqual(["2 HTML comments were left out."]);
  });
});

describe("what is refused", () => {
  it.each([
    [
      "an image's error handler",
      `<img src=x onerror="alert(1)">`,
      "<img> isn't allowed",
    ],
    [
      "a base URL",
      `<base href="https://evil.example/">`,
      "<base> isn't allowed",
    ],
    [
      "a meta refresh",
      `<meta http-equiv="refresh" content="0;url=https://evil.example">`,
      "the http-equiv attribute isn't allowed on <meta>",
    ],
    [
      "a script's load handler",
      `<script src="https://a.example/x.js" onload="steal()"></script>`,
      "the onload attribute runs code",
    ],
    [
      "a nonce",
      `<script nonce="guess">a()</script>`,
      "the nonce is the site's to set",
    ],
    [
      "a javascript: source",
      `<script src="javascript:alert(1)"></script>`,
      "uses javascript:, and only https: addresses are allowed",
    ],
    [
      "a javascript: source hidden by a tab",
      `<script src="java&#9;script:alert(1)"></script>`,
      "uses javascript:",
    ],
    [
      "a scheme-relative source",
      `<script src="//evil.example/x.js"></script>`,
      "points at another site without saying https:",
    ],
    [
      "a backslash host",
      `<script src="/\\evil.example/x.js"></script>`,
      "points at another site without saying https:",
    ],
    [
      "an http: source",
      `<script src="http://cdn.example/x.js"></script>`,
      "uses http:",
    ],
    [
      "a data: stylesheet",
      `<link rel="stylesheet" href="data:text/css,body{}">`,
      "uses data:",
    ],
    [
      "a script type that is not code or data",
      `<script type="text/plain">a()</script>`,
      `a script of type "text/plain" isn't allowed`,
    ],
    [
      "Next.js's data id, in any case",
      `<script id="__NEXT_DATA__" type="application/ld+json">{}</script>`,
      "a script id starting __next belongs to Next.js",
    ],
    [
      "a link relation off the list",
      `<link rel="import" href="https://a.example/x.html">`,
      `a link with rel "import" isn't allowed`,
    ],
    [
      "an element that swallows the page",
      `<style>a{}</style><div>`,
      "<div> isn't allowed",
    ],
    [
      "comment-start in a script, which can keep it from ending",
      `<script>a()<!--b</script>`,
      "its code contains <!--",
    ],
    [
      "an attribute named for the prototype",
      `<meta name="a" content="b" __proto__="x">`,
      "the __proto__ attribute isn't allowed on <meta>",
    ],
  ])("refuses %s", (_name, html, reason) => {
    expect(refusalsOf(html).join(" ")).toContain(reason);
  });

  it("holds every URL a stylesheet fetches to the attribute rule", () => {
    expect(
      refusalsOf(
        "<style>body{background:url(//tracker.example/p)}</style>"
      ).join(" ")
    ).toContain(
      'its styles load "//tracker.example/p", which points at another site without saying https:'
    );
    expect(
      refusalsOf('<style>@import "http://fonts.example/a.css";</style>').join(
        " "
      )
    ).toContain("which uses http:");
    expect(
      refusalsOf(
        "<style>@font-face{font-family:x;src:url(https://fonts.example/x.woff2)} .a{background:url(/img/a.png)}</style>"
      )
    ).toEqual([]);
  });

  it("runs every JavaScript type a browser runs, in any case, and refuses one with parameters", () => {
    expect(
      refusalsOf('<script type="application/javascript">a()</script>')
    ).toEqual([]);
    expect(refusalsOf('<script type=" TEXT/JavaScript ">a()</script>')).toEqual(
      []
    );
    expect(refusalsOf('<script type="">a()</script>')).toEqual([]);
    // A browser keeps this as data and never runs it, so it is refused.
    expect(
      refusalsOf(
        '<script type="text/javascript; charset=utf-8">a()</script>'
      ).join(" ")
    ).toContain("isn't allowed");
  });

  it("holds what a pixel's style attribute fetches to the attribute rule", () => {
    expect(
      refusalsOf(
        '<noscript><img src="/p.gif" style="background:url(//t.example/p)"></noscript>',
        "body"
      ).join(" ")
    ).toContain(
      'its style attribute loads "//t.example/p", which points at another site without saying https:'
    );
  });

  it("lets a preload load only what the check judges", () => {
    expect(
      refusalsOf(
        '<link rel="preload" as="fetch" href="https://api.example/d" crossorigin>'
      ).join(" ")
    ).toContain(`a preload of "fetch" isn't allowed`);
    expect(
      refusalsOf(
        '<link rel="PRELOAD" as="Script" href="https://cdn.example/a.js">'
      )
    ).toEqual([]);
  });

  it("reads a link's relation in any case, and an old favicon's shortcut", () => {
    expect(
      refusalsOf('<link rel="STYLESHEET" href="https://cdn.example/a.css">')
    ).toEqual([]);
    expect(
      refusalsOf('<link rel="shortcut icon" href="/favicon.ico">')
    ).toEqual([]);
    expect(
      refusalsOf('<link rel="shortcut" href="/favicon.ico">').join(" ")
    ).toContain(`a link with rel "shortcut" isn't allowed`);
  });

  it("refuses a link that would load more than one thing", () => {
    expect(
      refusalsOf(
        '<link rel="icon stylesheet" href="https://cdn.example/a.css">'
      ).join(" ")
    ).toContain("a link may load one thing, not icon and stylesheet");
  });

  it("refuses text outside an element", () => {
    expect(refusalsOf("hello <script>a()</script>")).toEqual([
      "Text outside an element isn't allowed.",
    ]);
  });

  it("stores nothing when anything is refused, and reports every problem", () => {
    const { entries, refusals } = sanitiseSiteCode(
      `<script>ok()</script><img src=x><base href="/">`,
      "head"
    );
    expect(entries).toEqual([]);
    expect(refusals).toHaveLength(2);
  });

  it("keeps each element in its slot", () => {
    expect(refusalsOf(`<meta name="a" content="b">`, "body")).toEqual([
      "<meta>: <meta> belongs in the head.",
    ]);
    expect(
      refusalsOf(`<noscript><img src="https://a.example/p.gif"></noscript>`)
    ).toEqual(["<noscript>: <noscript> belongs at the end of the body."]);
  });

  it("lets a no-script fallback hold one image or frame and nothing else", () => {
    expect(
      refusalsOf(
        `<noscript><img src="https://a.example/1.gif"><img src="https://a.example/2.gif"></noscript>`,
        "body"
      ).join(" ")
    ).toContain("may hold only one <img> or <iframe>");
    expect(
      refusalsOf(`<noscript><script>a()</script></noscript>`, "body").join(" ")
    ).toContain("not <script>");
    expect(
      refusalsOf(`<noscript><img></noscript>`, "body").join(" ")
    ).toContain("needs a src");
  });

  it("refuses a paste longer than one slot holds", () => {
    const long = `<script>${"a".repeat(SITE_CODE_LIMITS.slotChars)}</script>`;
    expect(refusalsOf(long)[0]).toContain(
      `longer than ${SITE_CODE_LIMITS.slotChars} characters`
    );
  });

  it("refuses more elements than one slot holds", () => {
    const many = `<meta name="a" content="b">`.repeat(
      SITE_CODE_LIMITS.entriesPerSlot + 1
    );
    expect(refusalsOf(many)).toEqual([
      `This holds ${SITE_CODE_LIMITS.entriesPerSlot + 1} elements; one place may hold at most ${SITE_CODE_LIMITS.entriesPerSlot}.`,
    ]);
  });
});

describe("stored text", () => {
  it("is stored with LF line endings, as a browser hashes it", () => {
    const { entries } = sanitiseSiteCode(
      "<script>a()\r\nb()\rc()</script>",
      "head"
    );
    expect(entries[0]).toEqual({
      tag: "script",
      attrs: {},
      text: "a()\nb()\nc()",
    });
  });

  it("is composed, so a hash taken at save matches the page", () => {
    expect(normaliseSiteCodeText("é")).toBe("é");
  });
});

describe("a stored entry judged again at render", () => {
  it("refuses a style or script edited to break out of its element", () => {
    expect(
      siteCodeEntryProblem(
        { tag: "style", attrs: {}, text: "a{}</style><script>x()</script>" },
        "head"
      )
    ).toContain("would end them early");
    expect(
      siteCodeEntryProblem(
        { tag: "script", attrs: {}, text: "</SCRIPT><img src=x onerror=y>" },
        "head"
      )
    ).toContain("would end it early");
  });

  it("refuses a row that is not an entry", () => {
    expect(siteCodeEntryProblem(null, "head")).toBe("it isn't an element");
    expect(siteCodeEntryProblem({ tag: "iframe", attrs: {} }, "head")).toBe(
      "<iframe> isn't allowed"
    );
    expect(
      siteCodeEntryProblem({ tag: "meta", attrs: { name: 1 } }, "head")
    ).toBe("its attributes can't be read");
    expect(
      siteCodeEntryProblem(
        {
          tag: "script",
          attrs: { src: "https://a.example/x.js" },
          text: "x()",
        },
        "head"
      )
    ).toBe("a script loaded by src holds no code of its own");
    expect(siteCodeEntryProblem({ tag: "script", attrs: {} }, "head")).toBe(
      "a script needs code or a src"
    );
  });
});
