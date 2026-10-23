/**
 * A path a plugin wrote relative to the admin becomes an href in one place, and
 * only a path that stays inside the admin becomes one at all.
 */
import { describe, expect, it } from "vitest";

import { adminHref, ROUTES } from "../routes";

describe("adminHref", () => {
  it("places a relative path under the admin", () => {
    expect(adminHref("collections/orders")).toBe(
      `${ROUTES.DASHBOARD}/collections/orders`
    );
    // A query and a fragment are part of a relative path, not a way out of it.
    expect(adminHref("collections/orders?status=open#top")).toBe(
      `${ROUTES.DASHBOARD}/collections/orders?status=open#top`
    );
    // Only the path's own segments are read: dots in a name or a query are not
    // a way out of it.
    expect(adminHref("collections/v1.2?from=../x")).toBe(
      `${ROUTES.DASHBOARD}/collections/v1.2?from=../x`
    );
  });

  it.each([
    ["a script", "javascript:alert(1)"],
    ["a script with a capital", "JavaScript:alert(1)"],
    ["another scheme", "https://example.com/orders"],
    ["a data URL", "data:text/html,hi"],
    ["a path from the site's root", "/collections/orders"],
    ["another host", "//example.com/orders"],
    ["a backslash", "collections\\orders"],
    ["a backslash that browsers read as a slash", "\\\\example.com"],
    ["nothing", ""],
    ["only spaces", "   "],
    // A browser resolves these before it navigates, so each would leave the
    // admin from under its prefix.
    ["a parent segment", "../logout"],
    ["a parent segment further in", "collections/../../account"],
    ["a parent segment at the end", "collections/.."],
    ["a current-directory segment", "./collections"],
    ["an encoded parent segment", "%2e%2e/logout"],
    ["a mixed-case encoded parent segment", "collections/%2E./account"],
    ["an encoded slash", "collections%2f..%2f..%2faccount"],
    ["an encoded backslash", "collections%5corders"],
    ["a segment that cannot be decoded", "collections/%e0%a4"],
  ])("draws no link for %s", (_, path) => {
    expect(adminHref(path)).toBeUndefined();
  });
});
