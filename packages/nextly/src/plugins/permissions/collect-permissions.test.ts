import { describe, expect, it } from "vitest";

import type { NextlyServiceConfig } from "../../di/register";
import type { PluginDefinition } from "../plugin-context";

import { collectCustomPermissions } from "./collect-permissions";

const cfg = (
  collections: string[] = [],
  singles: string[] = []
): NextlyServiceConfig =>
  ({
    collections: collections.map(slug => ({ slug, fields: [] })),
    singles: singles.map(slug => ({ slug, fields: [] })),
  }) as unknown as NextlyServiceConfig;

const plugin = (
  name: string,
  permissions: Array<Record<string, string>>,
  enabled = true
): PluginDefinition =>
  ({
    name,
    version: "1.0.0",
    nextly: ">=0.0.1",
    enabled,
    contributes: { permissions },
  }) as unknown as PluginDefinition;

describe("collectCustomPermissions", () => {
  it("collects + derives slug/name for a custom permission", () => {
    const out = collectCustomPermissions(cfg(), [
      plugin("@acme/seo", [
        { action: "manage", resource: "seo", label: "Manage SEO" },
      ]),
    ]);
    expect(out).toEqual([
      {
        action: "manage",
        resource: "seo",
        slug: "manage-seo",
        name: "Manage SEO",
        description: undefined,
        owner: "@acme/seo",
      },
    ]);
  });

  it("auto-generates a name when no label is given", () => {
    const out = collectCustomPermissions(cfg(), [
      plugin("@acme/x", [{ action: "export", resource: "submissions" }]),
    ]);
    expect(out[0]).toMatchObject({
      slug: "export-submissions",
      name: "Export Submissions",
    });
  });

  it("collects from disabled plugins too", () => {
    const out = collectCustomPermissions(cfg(), [
      plugin("@acme/x", [{ action: "manage", resource: "seo" }], false),
    ]);
    expect(out).toHaveLength(1);
  });

  it("throws on the same (action,resource) declared by two plugins", () => {
    expect(() =>
      collectCustomPermissions(cfg(), [
        plugin("@acme/a", [{ action: "export", resource: "submissions" }]),
        plugin("@acme/b", [{ action: "export", resource: "submissions" }]),
      ])
    ).toThrowError(/NEXTLY_PERMISSION_COLLISION|invalid/i);
  });

  it("throws when a custom resource is a system resource", () => {
    expect(() =>
      collectCustomPermissions(cfg(), [
        plugin("@acme/a", [{ action: "export", resource: "users" }]),
      ])
    ).toThrow();
  });

  it("throws when a custom perm shadows a collection CRUD permission", () => {
    expect(() =>
      collectCustomPermissions(cfg(["posts"]), [
        plugin("@acme/a", [{ action: "read", resource: "posts" }]),
      ])
    ).toThrow();
  });

  it("allows a non-CRUD action on a collection resource (e.g. manage-posts)", () => {
    const out = collectCustomPermissions(cfg(["posts"]), [
      plugin("@acme/a", [{ action: "manage", resource: "posts" }]),
    ]);
    expect(out[0].slug).toBe("manage-posts");
  });

  it("returns [] for a plugin-free config", () => {
    expect(collectCustomPermissions(cfg(["posts"]), [])).toEqual([]);
  });

  it("folds app-level config.permissions with owner 'app'", () => {
    const out = collectCustomPermissions(
      {
        ...cfg(),
        permissions: [{ action: "export", resource: "reports" }],
      } as unknown as NextlyServiceConfig,
      []
    );
    expect(out).toEqual([
      {
        action: "export",
        resource: "reports",
        slug: "export-reports",
        name: "Export Reports",
        description: undefined,
        owner: "app",
      },
    ]);
  });

  it("throws when an app permission duplicates a plugin permission", () => {
    expect(() =>
      collectCustomPermissions(
        {
          ...cfg(),
          permissions: [{ action: "export", resource: "submissions" }],
        } as unknown as NextlyServiceConfig,
        [plugin("@acme/a", [{ action: "export", resource: "submissions" }])]
      )
    ).toThrow();
  });

  it("throws when an app permission shadows a collection CRUD permission", () => {
    expect(() =>
      collectCustomPermissions(
        {
          ...cfg(["posts"]),
          permissions: [{ action: "read", resource: "posts" }],
        } as unknown as NextlyServiceConfig,
        []
      )
    ).toThrow();
  });
});
