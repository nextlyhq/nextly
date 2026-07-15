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
  permissions: Array<Record<string, unknown>>,
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
        group: "General",
        danger: false,
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
        group: "General",
        danger: false,
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

describe("what a declaration says beyond its identity", () => {
  // `group` was on the public interface, set by the canonical example, and
  // read by nothing: no column, no consumer. A field that accepts a value and
  // ignores it is worse than no field, because it looks like it worked.
  it("keeps the group a plugin declares", () => {
    const out = collectCustomPermissions(cfg(), [
      plugin("@acme/big", [
        { action: "export", resource: "reports", group: "Reporting" },
      ]),
    ]);

    expect(out[0].group).toBe("Reporting");
  });

  it("files an ungrouped permission under General", () => {
    const out = collectCustomPermissions(cfg(), [
      plugin("@acme/small", [{ action: "export", resource: "reports" }]),
    ]);

    expect(out[0].group).toBe("General");
  });

  // Defaulted at the edge so nothing downstream has to decide what an empty
  // string, a stray space, or undefined were supposed to mean.
  it("treats a blank group as no group", () => {
    const out = collectCustomPermissions(cfg(), [
      plugin("@acme/small", [
        { action: "export", resource: "reports", group: "   " },
      ]),
    ]);

    expect(out[0].group).toBe("General");
  });

  it("keeps a danger flag", () => {
    const out = collectCustomPermissions(cfg(), [
      plugin("@acme/x", [
        { action: "export", resource: "reports", danger: true },
      ]),
    ]);

    expect(out[0].danger).toBe(true);
  });

  it("is not dangerous unless the declaration says so", () => {
    const out = collectCustomPermissions(cfg(), [
      plugin("@acme/x", [{ action: "export", resource: "reports" }]),
    ]);

    expect(out[0].danger).toBe(false);
  });

  // A boolean, not anything truthy: `danger: "yes"` is a mistake, and reading
  // it as true would let a typo decide whether a warning appears.
  it("only accepts a real true", () => {
    const out = collectCustomPermissions(cfg(), [
      plugin("@acme/x", [
        { action: "export", resource: "reports", danger: "yes" },
      ]),
    ]);

    expect(out[0].danger).toBe(false);
  });
});
