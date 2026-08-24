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
