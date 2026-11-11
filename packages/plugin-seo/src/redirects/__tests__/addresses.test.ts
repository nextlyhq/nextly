import { describe, expect, it } from "vitest";

import {
  checkTarget,
  destinationOf,
  parseSource,
  pickRedirect,
  type HeldRow,
} from "../addresses";

describe("a redirect's From address", () => {
  it("reads an exact address and a pattern", () => {
    expect(parseSource("/old-page")).toEqual({
      ok: true,
      source: "/old-page",
      address: { path: "/old-page" },
    });
    expect(parseSource("  /old/*  ")).toEqual({
      ok: true,
      source: "/old/*",
      address: { path: "/old", range: true },
    });
  });

  it("drops a trailing slash, as the address is the same page", () => {
    expect(parseSource("/old/")).toMatchObject({
      source: "/old",
      address: { path: "/old" },
    });
  });

  it.each([
    ["", "Fill in the From address."],
    ["old-page", "Start the From address with /, for example /old-page."],
    ["//cdn/x", "Start the From address with /, for example /old-page."],
    ["/old page", "The From address can't contain spaces."],
    ["/old?x=1", "Leave the ? and what follows it off the From address."],
    ["/old#top", "Leave the # and what follows it off the From address."],
    ["/old/*/x", "Use * only at the end of the From address, as in /old/*."],
    ["/old*", "Use * only at the end of the From address, as in /old/*."],
    ["/*", "A pattern needs a fixed part before the *, as in /old/*."],
  ])("refuses %j", (text, message) => {
    expect(parseSource(text)).toEqual({ ok: false, error: message });
  });
});

describe("a redirect's To address", () => {
  it("accepts a path on the site, or a full https:// address", () => {
    expect(checkTarget("/new", "/old")).toBeNull();
    expect(checkTarget("https://example.com/new", "/old")).toBeNull();
    expect(checkTarget("/new/*", "/old/*")).toBeNull();
    expect(checkTarget("https://example.com/new/*", "/old/*")).toBeNull();
  });

  it.each([
    ["", "/old", "Fill in the To address."],
    ["/new page", "/old", "The To address can't contain spaces."],
    [
      "//evil.com",
      "/old",
      "Start the To address with a single /, or use a full https:// address.",
    ],
    [
      "/new/*",
      "/old",
      "The To address can only use * when the From address does.",
    ],
    [
      "/new/*/x",
      "/old/*",
      "Use * only at the end of the To address, as in /new/*.",
    ],
    [
      "http://example.com/new",
      "/old",
      "Use https:// for an address on another site.",
    ],
    [
      "new",
      "/old",
      "Start the To address with /, for example /blog, or use a full https:// address.",
    ],
    [
      "https://localhost/new",
      "/old",
      "The To address is missing the site's name, like example.com.",
    ],
    [
      "https://user:pass@example.com/new",
      "/old",
      "Remove the sign-in details from the To address.",
    ],
    ["/old", "/old", "That would send the address to itself."],
    ["/old/*", "/old/*", "That would send the address to itself."],
  ])("refuses %j from %j", (target, source, message) => {
    expect(checkTarget(target, source)).toBe(message);
  });
});

describe("where a redirect sends a request", () => {
  it("sends an exact redirect to its target", () => {
    expect(destinationOf({ source: "/old", target: "/new" }, "/old")).toBe(
      "/new"
    );
  });

  it("carries the rest of the address across a pattern", () => {
    const pattern = { source: "/old/*", target: "/new/*" };
    expect(destinationOf(pattern, "/old/a/b")).toBe("/new/a/b");
    expect(destinationOf(pattern, "/old")).toBe("/new");
    expect(destinationOf({ source: "/old/*", target: "/*" }, "/old")).toBe("/");
    expect(
      destinationOf(
        { source: "/old/*", target: "https://example.com/new/*" },
        "/old/x"
      )
    ).toBe("https://example.com/new/x");
  });

  it("sends a whole pattern to one place where the target has no *", () => {
    expect(
      destinationOf({ source: "/old/*", target: "/blog" }, "/old/a/b")
    ).toBe("/blog");
  });
});

describe("which redirect answers an address", () => {
  const redirect = (path: string, range = false, id = path): HeldRow => ({
    path,
    range,
    redirect: id,
  });
  const page = (path: string, range = false): HeldRow => ({
    path,
    range,
    redirect: null,
  });

  it("takes an exact match before any pattern", () => {
    expect(
      pickRedirect("/old/a", [redirect("/old", true), redirect("/old/a")])
    ).toBe("/old/a");
  });

  it("takes the pattern with the longest fixed part", () => {
    expect(
      pickRedirect("/a/b/c", [redirect("/a", true), redirect("/a/b", true)])
    ).toBe("/a/b");
  });

  it("serves a page held inside a pattern, and redirects nothing", () => {
    expect(
      pickRedirect("/old/kept", [redirect("/old", true), page("/old/kept")])
    ).toBeNull();
  });

  it("serves an address a page's range holds", () => {
    expect(
      pickRedirect("/blog/page/2", [
        redirect("/blog", true),
        page("/blog/page", true),
      ])
    ).toBeNull();
  });

  it("answers nothing where nothing matches", () => {
    expect(pickRedirect("/x", [])).toBeNull();
  });

  it("ignores a range that does not cover the address", () => {
    expect(pickRedirect("/older", [redirect("/old", true)])).toBeNull();
  });
});
