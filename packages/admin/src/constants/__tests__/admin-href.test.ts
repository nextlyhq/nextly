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
  ])("draws no link for %s", (_, path) => {
    expect(adminHref(path)).toBeUndefined();
  });
});
