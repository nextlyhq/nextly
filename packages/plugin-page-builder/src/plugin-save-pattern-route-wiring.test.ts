/**
 * Whether installing the plugin actually accepts a saved pattern.
 *
 * `save-pattern-route.test.ts` exercises the write directly, so every one of its
 * assertions passes with the route deleted from `contributes.routes` — the
 * module would be perfectly correct and never mounted, and the editor would post
 * to a path that answers 404. An author would click Save and be told nothing.
 *
 * This is the one assertion that fails when the wiring is absent.
 *
 * @module plugin-save-pattern-route-wiring.test
 */
import { describe, expect, it } from "vitest";

import type { PluginRoutePermissionScope as PermissionScope } from "@nextlyhq/plugin-sdk";

import { PATTERNS_SLUG } from "./collections/patterns";

import { SAVE_PATTERN_ROUTE_PATH } from "./library-contract";
import { pageBuilder } from "./plugin";

describe("the save-as-pattern route is contributed, not merely written", () => {
  const routes = pageBuilder().contributes?.routes ?? [];
  const save = routes.find(route => route.path === SAVE_PATTERN_ROUTE_PATH);

  it("is mounted at the path the editor will post to", () => {
    expect(save).toBeDefined();
    expect(save?.method).toBe("POST");
  });

  it("is NOT public", () => {
    // A plugin route is authenticated unless it opts out, so this asserts the
    // opt-out is absent rather than that a flag is set. An anonymous write here
    // would let anyone add a pattern every author on the site is then offered.
    expect(save?.public).not.toBe(true);
  });

  it("demands a permission that follows a renamed collection", () => {
    // This route carried NO permission, deliberately: a declared slug has to
    // spell the collection, a host may rename it, and the route would then
    // demand a grant seeded under a different name — uncallable on exactly the
    // installs that renamed it. The consequence was a write reachable by any
    // authenticated caller.
    //
    // A COMPUTED permission removes the reason without reintroducing the
    // problem, so what is pinned is that the demanded slug MOVES with the
    // collection rather than that some permission is declared.
    const required = save?.requiredPermission;
    expect(typeof required).toBe("function");

    const renamed = (required as (scope: PermissionScope) => string)({
      plugin: "@nextlyhq/plugin-page-builder",
      collection: (declared, action) =>
        `${action}-${declared === PATTERNS_SLUG ? "host_patterns" : declared}`,
      single: (declared, action) => `${action}-${declared}`,
    });
    expect(
      renamed,
      "the route must ask about the collection the host actually has"
    ).toBe("create-host_patterns");
  });

  it("is a route of its own, not the library read wearing a second method", () => {
    // The read and the write are separate contributions. One route object with
    // a method that varied would be a dispatcher this package wrote itself, and
    // the framework's own registry is what refuses a duplicate mount.
    const paths = routes.map(route => `${route.method} ${route.path}`);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toContain(`POST ${SAVE_PATTERN_ROUTE_PATH}`);
  });
});
