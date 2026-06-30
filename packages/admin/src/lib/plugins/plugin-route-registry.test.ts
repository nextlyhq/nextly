import { afterEach, describe, expect, it } from "vitest";

import { resolveRoute } from "@admin/lib/routing";

import {
  clearPluginPages,
  matchPluginPage,
  pluginPagePath,
  registerPluginPage,
  registerPluginPages,
} from "./plugin-route-registry";

afterEach(() => clearPluginPages());

describe("plugin route registry", () => {
  it("namespaces a page under /admin/plugins/<slug>/<path> and strips leading slash", () => {
    expect(pluginPagePath("acme-p", "reports")).toBe(
      "/admin/plugins/acme-p/reports"
    );
    expect(pluginPagePath("acme-p", "/reports")).toBe(
      "/admin/plugins/acme-p/reports"
    );
  });

  it("matches a registered plugin page exactly", () => {
    registerPluginPage({
      slug: "acme-p",
      path: "reports",
      component: "@acme/p/admin#Reports",
      requiredPermission: "read-reports",
    });
    expect(matchPluginPage("/admin/plugins/acme-p/reports")).toMatchObject({
      component: "@acme/p/admin#Reports",
      requiredPermission: "read-reports",
    });
    expect(matchPluginPage("/admin/plugins/acme-p/other")).toBeUndefined();
  });

  it("resolveRoute returns the plugin page with RBAC + pluginComponentPath", () => {
    registerPluginPages("acme-p", [
      {
        path: "reports",
        component: "@acme/p/admin#Reports",
        requiredPermission: "read-reports",
      },
    ]);
    const r = resolveRoute("/admin/plugins/acme-p/reports", "");
    expect(r.routeType).toBe("private");
    expect(r.requiredPermission).toBe("read-reports");
    expect(r.pluginComponentPath).toBe("@acme/p/admin#Reports");
  });

  it("resolveRoute does not treat an unregistered plugin path as a plugin page", () => {
    const r = resolveRoute("/admin/plugins/acme-p/missing", "");
    expect(r.pluginComponentPath).toBeUndefined();
  });
});
