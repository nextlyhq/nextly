import { describe, expect, it } from "vitest";

import type { NextlyServiceConfig } from "../../di/register";
import type { PluginDefinition } from "../plugin-context";
import { collectCodegenNames } from "./collect-codegen-names";

function cfg(partial: Record<string, unknown>): NextlyServiceConfig {
  return partial as unknown as NextlyServiceConfig;
}

describe("collectCodegenNames (D47)", () => {
  it("includes CRUD permission slugs per collection and read/update per single", () => {
    const { permissionSlugs } = collectCodegenNames(
      cfg({
        collections: [{ slug: "posts" }],
        singles: [{ slug: "site-settings" }],
      }),
      []
    );

    expect(permissionSlugs).toEqual(
      expect.arrayContaining([
        "create-posts",
        "read-posts",
        "update-posts",
        "delete-posts",
        "read-site-settings",
        "update-site-settings",
      ])
    );
    // Singles get read/update only — no create/delete.
    expect(permissionSlugs).not.toContain("create-site-settings");
    expect(permissionSlugs).not.toContain("delete-site-settings");
  });

  it("includes custom plugin permissions + core and plugin event names", () => {
    const plugin = {
      name: "@acme/x",
      version: "1.0.0",
      nextly: "*",
      contributes: {
        permissions: [
          { action: "export", resource: "submissions", label: "Export" },
        ],
        events: [{ name: "acme.x.done" }],
      },
    } as unknown as PluginDefinition;

    const { permissionSlugs, eventNames } = collectCodegenNames(
      cfg({ collections: [{ slug: "posts" }] }),
      [plugin]
    );

    expect(permissionSlugs).toContain("export-submissions");
    expect(eventNames).toEqual(
      expect.arrayContaining([
        "collection.posts.created",
        "collection.posts.updated",
        "collection.posts.deleted",
        "plugin.initialized",
        "acme.x.done",
        "document.published",
        "auth.loggedIn",
        "media.uploaded",
      ])
    );
  });

  it("is sorted and deduped", () => {
    const { permissionSlugs, eventNames } = collectCodegenNames(
      cfg({ collections: [{ slug: "a" }, { slug: "a" }] }),
      []
    );

    expect(permissionSlugs).toEqual([...permissionSlugs].sort());
    expect(eventNames).toEqual([...eventNames].sort());
    expect(permissionSlugs.filter(s => s === "read-a")).toHaveLength(1);
  });
});
