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

import { LIBRARY_ROUTE_PATH } from "./library-route";
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

  it("declares no permission, so a renamed collection stays reachable", () => {
    // Deliberate, and worth pinning because "add the obvious permission" is the
    // natural next edit. A declared permission has to spell the collection
    // slug, a host may rename that collection, and the seeded grant then
    // carries the new name while the route demands the old one — a route
    // nobody can call. The read runs as the user, so the service enforces the
    // real, resolved permission instead.
    expect(library?.requiredPermission).toBeUndefined();
  });
});
