// @vitest-environment jsdom

/**
 * `navigateWithinAdmin`, the navigation a plugin is given.
 *
 * A plugin hands it an address it built, so the address is outside input: it
 * moves the author only to a page of this admin, and anything else is refused
 * by name rather than followed or quietly rewritten into an admin path.
 */
import { afterEach, describe, expect, it } from "vitest";

import { navigateWithinAdmin } from "./navigation";

afterEach(() => {
  window.history.pushState(null, "", "/");
});

describe("navigateWithinAdmin", () => {
  it("moves to an admin address, keeping its query", () => {
    navigateWithinAdmin("/admin/collections/pages/p1/builder?field=body");
    expect(window.location.pathname).toBe(
      "/admin/collections/pages/p1/builder"
    );
    expect(window.location.search).toBe("?field=body");
  });

  it("can clear a query, moving to the same path without it", () => {
    window.history.pushState(
      null,
      "",
      "/admin/collections/pages/p1/builder?field=body"
    );
    navigateWithinAdmin("/admin/collections/pages/p1/builder");
    expect(window.location.pathname).toBe(
      "/admin/collections/pages/p1/builder"
    );
    expect(window.location.search).toBe("");
  });

  it.each([
    "https://example.com/admin/collections",
    "//example.com/admin/collections",
    "javascript:alert(1)",
    "/somewhere-else",
    "/administrator",
    "admin/collections",
    "/admin/../logout",
  ])("refuses %j by name, and stays where it is", href => {
    window.history.pushState(null, "", "/admin/collections/pages/p1");
    expect(() => navigateWithinAdmin(href)).toThrow(href);
    expect(window.location.pathname).toBe("/admin/collections/pages/p1");
  });
});
