/**
 * Stored site code in plain words: each kind of element named by what it is
 * for and where it loads from, like ones counted together, in the order they
 * first appear.
 *
 * @module site-code/describe.test
 */
import { describe, expect, it } from "vitest";

import { describeSiteCode } from "./describe";
import type { SiteCodeEntry } from "./rules";

const GTAG = "https://www.googletagmanager.com/gtag/js?id=G-1";

describe("describing site code", () => {
  it("names a tag manager snippet as the prototype does", () => {
    const head: SiteCodeEntry[] = [
      { tag: "script", attrs: { async: "", src: GTAG } },
      { tag: "script", attrs: {}, text: "gtag('js', new Date())" },
      {
        tag: "meta",
        attrs: { name: "google-site-verification", content: "k3J9" },
      },
    ];
    expect(describeSiteCode(head)).toEqual([
      "A script from www.googletagmanager.com",
      "an inline script",
      "a verification tag",
    ]);
  });

  it("counts like elements together, keeping where each first appears", () => {
    expect(
      describeSiteCode([
        { tag: "script", attrs: {}, text: "a()" },
        { tag: "style", attrs: {}, text: "a{}" },
        { tag: "script", attrs: {}, text: "b()" },
      ])
    ).toEqual(["2 inline scripts", "an inline style block"]);
  });

  it("names what a link and a no-script pixel are for", () => {
    expect(
      describeSiteCode([
        {
          tag: "link",
          attrs: { rel: "preconnect", href: "https://fonts.gstatic.com" },
        },
        { tag: "link", attrs: { rel: "stylesheet", href: "/site.css" } },
        { tag: "link", attrs: { rel: "shortcut icon", href: "/favicon.ico" } },
        { tag: "script", attrs: { type: "application/ld+json" }, text: "{}" },
      ])
    ).toEqual([
      "A connection hint for fonts.gstatic.com",
      "a stylesheet from this site",
      "an icon",
      "a structured data block",
    ]);
    expect(
      describeSiteCode([
        {
          tag: "noscript",
          child: {
            tag: "iframe",
            attrs: { src: "https://www.googletagmanager.com/ns.html?id=GTM-1" },
          },
        },
      ])
    ).toEqual(["A no-script frame from www.googletagmanager.com"]);
  });

  it("tells a verification tag from another meta tag", () => {
    expect(
      describeSiteCode([
        { tag: "meta", attrs: { name: "msvalidate.01", content: "a" } },
        {
          tag: "meta",
          attrs: { name: "facebook-domain-verification", content: "b" },
        },
        { tag: "meta", attrs: { property: "og:site_name", content: "Acme" } },
      ])
    ).toEqual(["2 verification tags", "a meta tag (og:site_name)"]);
  });

  it("says nothing of an empty place", () => {
    expect(describeSiteCode([])).toEqual([]);
  });
});
