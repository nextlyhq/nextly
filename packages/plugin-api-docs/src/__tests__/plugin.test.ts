/**
 * Tests for the API Docs plugin definition.
 *
 * Pins the contributed routes' configuration (paths, verbs, and the
 * visibility-driven `public` flag — the plugin's security gate) and the pure
 * Scalar page renderer. The spec handler is a thin wrapper over
 * `generateOpenApiDocument` (covered by its own tests) fed by the sdk seams.
 *
 * @module __tests__/plugin
 * @since alpha
 */
import { describe, expect, it } from "vitest";

import { apiDocsPlugin, renderDocsHtml } from "../plugin";
import type { PluginRoute } from "@nextlyhq/plugin-sdk";

const routesOf = (visibility?: "admin" | "public"): readonly PluginRoute[] =>
  apiDocsPlugin(visibility ? { visibility } : undefined).contributes?.routes ??
  [];

describe("apiDocsPlugin routes", () => {
  it("contributes GET /docs, /docs/spec.json, /docs/scalar.js at the admin API root", () => {
    const routes = routesOf();
    const paths = routes.map(r => r.path).sort();
    expect(paths).toEqual(["/docs", "/docs/scalar.js", "/docs/spec.json"]);
    expect(routes.every(r => r.method === "GET")).toBe(true);
    // First-party surface: mounted at the admin API root, not the plugin namespace.
    expect(routes.every(r => r.mount === "admin-api")).toBe(true);
  });

  it("admin-gates the spec by default (no `public` flag)", () => {
    const spec = routesOf().find(r => r.path === "/docs/spec.json");
    expect(spec?.public).toBeFalsy();
  });

  it("publishes the spec when visibility is explicitly 'public'", () => {
    const spec = routesOf("public").find(r => r.path === "/docs/spec.json");
    expect(spec?.public).toBe(true);
  });

  it("keeps the docs page free of a permission requirement (it self-gates)", () => {
    const docs = routesOf().find(r => r.path === "/docs");
    expect(docs?.requiredPermission).toBeUndefined();
  });

  it("contributes a sidebar menu entry that links to /admin/api/docs", () => {
    const item = apiDocsPlugin().contributes?.admin?.menu?.[0];
    expect(item?.label).toBe("API Docs");
    expect(item?.to).toBe("/admin/api/docs");
    expect(item?.icon).toBe("BookOpen");
  });

  it("moves the whole surface with a custom docsPath (configured in nextly.config)", () => {
    const routes =
      apiDocsPlugin({ docsPath: "/api-docs" }).contributes?.routes ?? [];
    const paths = routes.map(r => r.path).sort();
    expect(paths).toEqual([
      "/api-docs",
      "/api-docs/scalar.js",
      "/api-docs/spec.json",
    ]);
    const item = apiDocsPlugin({ docsPath: "/api-docs" }).contributes?.admin
      ?.menu?.[0];
    expect(item?.to).toBe("/admin/api/api-docs");
  });

  it("refuses a docsPath without a leading slash", () => {
    expect(() => apiDocsPlugin({ docsPath: "docs" })).toThrow(/docsPath/);
  });

  it("honors a custom label", () => {
    const item = apiDocsPlugin({ label: "Reference" }).contributes?.admin
      ?.menu?.[0];
    expect(item?.label).toBe("Reference");
  });
});

describe("renderDocsHtml", () => {
  it("returns an HTML document loading the plugin-served Scalar bundle and pointing at the spec route", () => {
    const html = renderDocsHtml(
      "/admin/api/docs/spec.json",
      "/admin/api/docs/scalar.js"
    );
    expect(html).toContain("<!doctype html>");
    // The bundle is served same-origin by the plugin — no CDN reference.
    expect(html).not.toContain("cdn.jsdelivr.net");
    expect(html).toContain('data-url="/admin/api/docs/spec.json"');
    expect(html).toContain('src="/admin/api/docs/scalar.js"');
  });

  it("escapes a double quote in the URLs so the attributes cannot break", () => {
    const html = renderDocsHtml('/a"b', '/c"d');
    expect(html).toContain('data-url="/a&quot;b"');
    expect(html).toContain('src="/c&quot;d"');
  });
});
