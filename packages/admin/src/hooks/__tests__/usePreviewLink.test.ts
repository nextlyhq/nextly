/**
 * Preview link assembly.
 *
 * The URL is built by hand from three pieces the admin does not control
 * together — a configured site URL, a route the user's own app mounted, and a
 * signed token — so the joins are where it breaks.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_PREVIEW_ROUTE, buildPreviewUrl } from "../usePreviewLink";

describe("buildPreviewUrl", () => {
  it("uses the conventional route when the app has not moved it", () => {
    expect(buildPreviewUrl({ token: "abc" })).toBe(
      `${DEFAULT_PREVIEW_ROUTE}?token=abc`
    );
  });

  it("returns a relative link when no site url is configured", () => {
    // Correct when the admin and the site share an origin, which is the
    // default deployment, and useless when they do not — so the caller
    // supplies a site url rather than this guessing an origin.
    expect(buildPreviewUrl({ token: "abc" }).startsWith("/")).toBe(true);
  });

  it("joins a site url without doubling the slash", () => {
    // A trailing slash on a configured site url is common enough that not
    // handling it would produce `https://site.com//api/preview`.
    for (const siteUrl of ["https://site.com", "https://site.com/"]) {
      expect(buildPreviewUrl({ token: "abc", siteUrl })).toBe(
        `https://site.com${DEFAULT_PREVIEW_ROUTE}?token=abc`
      );
    }
  });

  it("honours an app that mounted the route elsewhere", () => {
    expect(
      buildPreviewUrl({
        token: "abc",
        siteUrl: "https://site.com",
        previewRoute: "/preview",
      })
    ).toBe("https://site.com/preview?token=abc");
  });

  it("encodes the token rather than interpolating it raw", () => {
    // A token is base64url and safe today. Assembling a query value by hand is
    // exactly where that assumption stops being true later.
    expect(buildPreviewUrl({ token: "a+b/c=d&e" })).toBe(
      `${DEFAULT_PREVIEW_ROUTE}?token=a%2Bb%2Fc%3Dd%26e`
    );
  });
});
