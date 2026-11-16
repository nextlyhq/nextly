/**
 * One spelling per served address: every way of writing an address names the
 * same key, and a path no document can be served at names none.
 */
import { describe, expect, it } from "vitest";

import {
  claimKey,
  servedAddress,
  spaceHolding,
  waitingKey,
  type ServedAddress,
} from "./claim-key";

const at = (path: string, locale = "en"): ServedAddress => {
  const address = servedAddress(locale, path);
  if (address === null) throw new Error(`${path} names no address`);
  return address;
};

describe("the canonical address", () => {
  it.each([
    "/about",
    "/about/",
    "about",
    "//about",
    "/about//",
    "/%61bout",
    "https://example.com/about",
    "http://localhost:3000/about?ref=nav#team",
  ])("spells %s as /about", path => {
    expect(claimKey("address", at(path))).toBe("addr:en|/about");
  });

  it("keeps a page's segments, so an address of several needs no new format", () => {
    expect(at("/blog/2026/hello").segments).toEqual(["blog", "2026", "hello"]);
    expect(claimKey("address", at("/blog/2026/hello"))).toBe(
      "addr:en|/blog/2026/hello"
    );
  });

  it("holds the site's root as an address of no segments", () => {
    expect(claimKey("address", at("/"))).toBe("addr:en|/");
  });

  it("keeps composed and decomposed letters apart, as the route serves them", () => {
    expect(claimKey("address", at("/caf\u00e9"))).not.toBe(
      claimKey("address", at("/cafe\u0301"))
    );
    // One spelling, encoded or not, is still one address.
    expect(claimKey("address", at("/caf%C3%A9"))).toBe(
      claimKey("address", at("/caf\u00e9"))
    );
  });

  it("encodes each segment, so a slash inside one is not a boundary", () => {
    expect(claimKey("address", at("/a b/c"))).toBe("addr:en|/a%20b/c");
  });

  it.each([
    ["a reserved path", "/admin/pages"],
    ["the API", "/api/health"],
    ["a dot segment", "/blog/../admin"],
    ["a current-directory segment", "/blog/./post"],
    ["an encoded slash", "/a%2Fb"],
    ["broken percent-encoding", "/%E0%A4%A"],
    ["a backslash, which a browser reads as a slash", "/a\\b"],
    ["a tab, which a browser drops", "/a\tb"],
    ["a line break", "/a\nb"],
  ])("names no address for %s", (_why, path) => {
    expect(servedAddress("en", path)).toBeNull();
  });

  it("refuses a locale that would read as part of the path", () => {
    expect(servedAddress("", "/about")).toBeNull();
    expect(servedAddress("en|fr", "/about")).toBeNull();
  });

  it("puts the language in the key, so one path is one address per language", () => {
    expect(claimKey("address", at("/about", "fr"))).toBe("addr:fr|/about");
    expect(claimKey("address", at("/about", "fr"))).not.toBe(
      claimKey("address", at("/about", "en"))
    );
  });
});

describe("the keys of each kind", () => {
  it("namespaces an address, a space and a lock on one path apart", () => {
    const news = at("/news");
    expect(
      new Set([
        claimKey("address", news),
        claimKey("space", news),
        claimKey("lock", news),
      ]).size
    ).toBe(3);
  });

  it("keys a wait by who waits and on what, so each blocking claim is one row", () => {
    const blocking = claimKey("address", at("/blog/hello"));
    expect(
      waitingKey(
        { collection: "posts", id: "p:1" },
        at("/blog/hello"),
        blocking
      )
    ).toBe("wait:posts:p%3A1|en|/blog/hello|addr:en|/blog/hello");
  });
});

describe("the ends of a path", () => {
  it("drops the spaces and controls URL parsing drops, and nothing else", () => {
    expect(at(" /about \t")).toEqual(at("/about"));
    // A no-break space is percent-encoded by a browser and served at its own
    // address, so it is part of the path.
    expect(at("/about\u00a0")).not.toEqual(at("/about"));
    expect(at("/about\u00a0")?.segments).toEqual(["about\u00a0"]);
  });
});

describe("the space a later page falls in", () => {
  it("places /news/page/2 in the space of /news", () => {
    expect(spaceHolding(at("/news/page/2"))).toEqual(at("/news"));
    expect(spaceHolding(at("/blog/post/page/12"))).toEqual(at("/blog/post"));
  });

  it("places a root list's pages in the root's space", () => {
    expect(spaceHolding(at("/page/3"))).toEqual(at("/"));
  });

  it.each([
    ["the list's own address", "/news"],
    ["a page segment with no number", "/news/page"],
    ["a number with a leading zero", "/news/page/02"],
    ["page zero", "/news/page/0"],
    // Page one is the list's own address under a second spelling, which a
    // page of its own may hold.
    ["page one", "/news/page/1"],
    // Too long to hold exactly, so the route serves no page there.
    ["a number the route reads as no page", "/news/page/99999999999999999999"],
    ["a word where the number goes", "/news/page/two"],
    ["a number not after the page segment", "/news/2"],
  ])("finds no space for %s", (_why, path) => {
    expect(spaceHolding(at(path))).toBeNull();
  });
});
