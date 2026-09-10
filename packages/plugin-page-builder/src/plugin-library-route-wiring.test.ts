/**
 * Whether installing the plugin actually serves the pattern library.
 *
 * `library-route.test.ts` exercises the read directly, so every one of its
 * assertions passes with the route deleted from `contributes.routes` — the
 * module would be perfectly correct and never mounted, and the insert panel
 * would ask for a path that answers 404. An author would see an empty Patterns
 * tier on a site with a full library, with no error anywhere.
 *
 * This is the one assertion that fails when the wiring is absent.
 *
 * @module plugin-library-route-wiring.test
 */
import { describe, expect, it } from "vitest";

import type { PluginRoutePermissionScope as PermissionScope } from "@nextlyhq/plugin-sdk";

import { PATTERNS_SLUG } from "./collections/patterns";

import { LIBRARY_ROUTE_PATH } from "./library-contract";
import { pageBuilder } from "./plugin";

describe("the library route is contributed, not merely written", () => {
  const routes = pageBuilder().contributes?.routes ?? [];
  const library = routes.find(route => route.path === LIBRARY_ROUTE_PATH);

  it("is mounted at the path the panel will ask for", () => {
    expect(library).toBeDefined();
    expect(library?.method).toBe("GET");
  });

  it("is NOT public", () => {
    // A plugin route is authenticated unless it opts out, so this asserts the
    // opt-out is absent rather than that a flag is set. The library is every
    // saved pattern on the site; an anonymous read of it is a content leak.
    expect(library?.public).not.toBe(true);
  });

  it("demands a permission that follows a renamed collection", () => {
    // Pinned as a MOVING slug rather than as "some permission is declared".
    // A fixed one would name a grant nobody on a renamed install was seeded,
    // which is why this route carried none at all and any authenticated caller
    // could enumerate the library. See the save route's twin of this test.
    const required = library?.requiredPermission;
    expect(typeof required).toBe("function");

    const renamed = (required as (scope: PermissionScope) => string)({
      plugin: "@nextlyhq/plugin-page-builder",
      collection: (declared, action) =>
        `${action}-${declared === PATTERNS_SLUG ? "host_patterns" : declared}`,
      single: (declared, action) => `${action}-${declared}`,
    });
    expect(renamed).toBe("read-host_patterns");
  });
});
