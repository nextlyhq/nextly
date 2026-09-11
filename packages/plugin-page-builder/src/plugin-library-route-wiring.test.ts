/**
 * Whether installing the plugin actually serves the pattern library, and the
 * component library beside it.
 *
 * `library-route.test.ts` exercises the reads directly, so every one of its
 * assertions passes with a route deleted from `contributes.routes` — the
 * module would be perfectly correct and never mounted, and the insert panel
 * would ask for a path that answers 404. An author would see an empty Patterns
 * tier on a site with a full library, or every component drawn as a
 * placeholder, with no error anywhere.
 *
 * These are the assertions that fail when the wiring is absent.
 *
 * @module plugin-library-route-wiring.test
 */
import { describe, expect, it } from "vitest";

import type { PluginRoutePermissionScope as PermissionScope } from "@nextlyhq/plugin-sdk";

import { COMPONENTS_SLUG } from "./collections/components";
import { PATTERNS_SLUG } from "./collections/patterns";

import {
  COMPONENT_LIBRARY_ROUTE_PATH,
  LIBRARY_ROUTE_PATH,
} from "./library-contract";
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

describe("the component library route is contributed beside it", () => {
  const routes = pageBuilder().contributes?.routes ?? [];
  const components = routes.find(
    route => route.path === COMPONENT_LIBRARY_ROUTE_PATH
  );

  it("is mounted at the path the editor asks for, and is NOT public", () => {
    expect(components).toBeDefined();
    expect(components?.method).toBe("GET");
    expect(components?.public).not.toBe(true);
  });

  it("demands the COMPONENTS collection's read permission, following a rename", () => {
    // Its own gate, not the pattern route's. A role that may read components
    // and not patterns would otherwise be refused the definitions its pages
    // are drawn from, and every instance would render as a placeholder — the
    // same route answering 403 for the caller most in need of it.
    const required = components?.requiredPermission;
    expect(typeof required).toBe("function");

    const renamed = (required as (scope: PermissionScope) => string)({
      plugin: "@nextlyhq/plugin-page-builder",
      collection: (declared, action) =>
        `${action}-${declared === COMPONENTS_SLUG ? "host_components" : declared}`,
      single: (declared, action) => `${action}-${declared}`,
    });
    expect(renamed).toBe("read-host_components");
  });

  it("gates on the collection the plugin was told components live in, when it was told one", () => {
    // The readiness notice already follows `componentReadiness.collection`;
    // the editor's read follows the same statement, so a host that keeps its
    // definitions in a collection of its own says so once. A store the plugin
    // does not own resolves to its own name, which is what the scope helper
    // does for a slug the plugin never contributed.
    const routes =
      pageBuilder({
        componentReadiness: { collection: "site_components", field: "blocks" },
      }).contributes?.routes ?? [];
    const required = routes.find(
      route => route.path === COMPONENT_LIBRARY_ROUTE_PATH
    )?.requiredPermission;

    const slug = (required as (scope: PermissionScope) => string)({
      plugin: "@nextlyhq/plugin-page-builder",
      collection: (declared, action) =>
        `${action}-${declared === COMPONENTS_SLUG ? "host_components" : declared}`,
      single: (declared, action) => `${action}-${declared}`,
    });
    expect(slug).toBe("read-site_components");
  });
});
