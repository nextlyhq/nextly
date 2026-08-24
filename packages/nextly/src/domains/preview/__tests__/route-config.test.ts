/**
 * Where this application mounts the preview route.
 *
 * The value is declared rather than guessed because the mount is a file inside
 * the application, invisible from the admin that has to link to it. What these
 * cover is the refusals: a bad value here produces a link that answers 404 for
 * a reviewer with nothing to explain it, so it has to fail at boot instead.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import { resolvePreviewRoute } from "../route-config";

describe("resolvePreviewRoute", () => {
  it("defaults to /api/preview", () => {
    expect(resolvePreviewRoute(undefined)).toBe("/api/preview");
    expect(resolvePreviewRoute({})).toBe("/api/preview");
  });

  it("accepts a site-relative override", () => {
    expect(resolvePreviewRoute({ route: "/preview" })).toBe("/preview");
  });

  it("accepts a nested path", () => {
    expect(resolvePreviewRoute({ route: "/next/preview" })).toBe(
      "/next/preview"
    );
  });

  it("strips a trailing slash so the query separator is never doubled", () => {
    expect(resolvePreviewRoute({ route: "/preview/" })).toBe("/preview");
  });

  // The link builder assigns this value as a PATHNAME, where `?` and `#` are
  // percent-encoded rather than starting a query or a fragment. A value
  // carrying either is handed out as `/api/preview%3Ftenant=a`, which reaches
  // no route and carries no token — so it is refused here, where an operator
  // can still read why, rather than silently dropped.
  it.each([
    ["a query", "/api/preview?tenant=a"],
    ["a fragment", "/api/preview#section"],
    ["both", "/api/preview?tenant=a#section"],
  ])("refuses a mount path carrying %s", (_label, bad) => {
    expect(() => resolvePreviewRoute({ route: bad })).toThrow(NextlyError);
    expect(() => resolvePreviewRoute({ route: bad })).toThrow(
      /no query or fragment/i
    );
  });

  // An encoded `%3F` is a character in a path, not a separator, and the parser
  // is what tells them apart. Refusing it too would reject a legitimate mount.
  it("accepts an encoded question mark, which is a path character", () => {
    expect(resolvePreviewRoute({ route: "/api/%3Fpreview" })).toBe(
      "/api/%3Fpreview"
    );
  });

  // Refused rather than resolved, because this function cannot see the base the
  // value is joined under. With `siteUrl = "https://site.example/base"` the link
  // builder appends the mount to that path, so `..` resolved here against the
  // origin and resolved there against `/base` give different routes. Encoded
  // and backslash spellings go the same way, because the URL parser resolves
  // those as segments too.
  it.each([
    ["a parent segment", "/api/../evil"],
    ["one that escapes the root", "/../preview"],
    ["an encoded parent segment", "/api/%2E%2E/evil"],
    ["a backslash-separated one", "/api/..%5Cevil"],
  ])("refuses %s", (_label, bad) => {
    expect(() => resolvePreviewRoute({ route: bad })).toThrow(NextlyError);
    expect(() => resolvePreviewRoute({ route: bad })).toThrow(/"\.\." segment/);
  });

  // A single dot cannot escape anything, so it is normalised rather than
  // refused — the same path whichever base it is joined under.
  it("accepts a current-directory segment, which resolves to the same path", () => {
    expect(resolvePreviewRoute({ route: "/api/./preview" })).toBe(
      "/api/preview"
    );
  });

  // A protocol-relative `//host` is a URL to another origin wearing a path's
  // clothes, which is why matching a leading slash is not enough on its own.
  it.each([
    ["a bare path", "preview"],
    ["an absolute URL", "https://elsewhere.example/preview"],
    ["a protocol-relative URL", "//elsewhere.example"],
    ["a backslash-prefixed path", String.raw`/\elsewhere.example`],
    ["an empty string", ""],
  ])("refuses %s", (_label, bad) => {
    expect(() => resolvePreviewRoute({ route: bad })).toThrow(NextlyError);
    expect(() => resolvePreviewRoute({ route: bad })).toThrow(/site-relative/i);
  });
});
