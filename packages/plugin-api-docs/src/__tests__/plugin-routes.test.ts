/**
 * Tests for plugin-route derivation from the sdk's read-only view.
 *
 * @module __tests__/plugin-routes
 * @since alpha
 */
import { describe, expect, it } from "vitest";

import type { PluginRouteInfo } from "@nextlyhq/plugin-sdk";

import { pluginRoutesToDocs } from "../plugin-routes";

const info = (
  over: Partial<{
    pluginName: string;
    method: PluginRouteInfo["method"];
    path: string;
    public: boolean;
    requiredPermission: string;
  }> & {
    openapi?: { summary?: string; description?: string; tags?: string[] };
  }
): PluginRouteInfo => {
  const pluginName = over.pluginName ?? "form-builder";
  const path = over.path ?? "/submit";
  return {
    pluginName,
    method: over.method ?? "POST",
    path,
    fullPath: `/plugins/${pluginName}${path}`,
    public: over.public ?? false,
    requiredPermission: over.requiredPermission,
    openapi: over.openapi,
  };
};

describe("pluginRoutesToDocs", () => {
  it("marks a public route public with no permission slug", () => {
    const [d] = pluginRoutesToDocs([info({ public: true })]);
    expect(d.auth).toBe("public");
    expect(d.permissionSlug).toBeUndefined();
  });

  it("marks a route with requiredPermission as permission-gated", () => {
    const [d] = pluginRoutesToDocs([
      info({
        pluginName: "seo",
        method: "GET",
        path: "/sitemap",
        requiredPermission: "read-settings",
      }),
    ]);
    expect(d.auth).toBe("permission");
    expect(d.permissionSlug).toBe("read-settings");
  });

  it("marks a secure-by-default route (no flags) as authenticated", () => {
    const [d] = pluginRoutesToDocs([
      info({ pluginName: "seo", method: "GET", path: "/stats" }),
    ]);
    expect(d.auth).toBe("authenticated");
    expect(d.permissionSlug).toBeUndefined();
  });

  it("converts :param segments to OpenAPI {param} templates", () => {
    const [d] = pluginRoutesToDocs([
      info({ method: "DELETE", path: "/forms/:id/fields/:field" }),
    ]);
    expect(d.path).toBe("/plugins/form-builder/forms/{id}/fields/{field}");
  });

  it("produces stable, unique operation ids across plugins and verbs", () => {
    const docs = pluginRoutesToDocs([
      info({ pluginName: "seo", method: "GET", path: "/sitemap" }),
      info({ pluginName: "seo", method: "POST", path: "/sitemap" }),
      info({ pluginName: "form-builder", method: "GET", path: "/submit" }),
    ]);
    const ids = docs.map(d => d.operation);
    expect(new Set(ids).size).toBe(ids.length);
    expect(docs[0]?.operation).toBe("seo.get.sitemap");
    expect(docs[1]?.operation).toBe("seo.post.sitemap");
    expect(docs[2]?.operation).toBe("form-builder.get.submit");
  });

  it("folds an optional openapi annotation into the operation", () => {
    const [d] = pluginRoutesToDocs([
      info({
        pluginName: "seo",
        method: "GET",
        path: "/sitemap",
        openapi: {
          summary: "Sitemap",
          description: "XML sitemap of published entries.",
          tags: ["search"],
        },
      }),
    ]);
    expect(d.summary).toBe("Sitemap");
    expect(d.description).toBe("XML sitemap of published entries.");
    expect(d.tags).toEqual(["search"]);
  });

  it("omits annotation fields when no openapi block is present", () => {
    const [d] = pluginRoutesToDocs([
      info({ pluginName: "seo", method: "GET", path: "/sitemap" }),
    ]);
    expect(d.summary).toBeUndefined();
    expect(d.description).toBeUndefined();
    expect(d.tags).toBeUndefined();
  });

  it("tags every operation with its plugin", () => {
    const [d] = pluginRoutesToDocs([
      info({ pluginName: "seo", method: "GET", path: "/sitemap" }),
    ]);
    expect(d.tag).toBe("Plugin: seo");
    expect(d.service).toBe("plugins");
  });
});
