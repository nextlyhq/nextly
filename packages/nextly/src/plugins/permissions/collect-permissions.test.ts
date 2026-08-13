import { describe, expect, it } from "vitest";

import type { NextlyServiceConfig } from "../../di/register";
import type { PluginDefinition } from "../plugin-context";

import {
  collectCustomPermissions,
  collectUnresolvedPermissionTargets,
  finalizePermissionTargets,
} from "./collect-permissions";

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
        source: "plugin",
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
        // The host's declarations are discriminated from a plugin's by this
        // rather than by `owner`, which a plugin named `app` would share.
        source: "app",
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

describe("the publish lifecycle a plugin may already have declared", () => {
  // These verbs were legal for a plugin to declare until the seeder started
  // emitting them. Rejecting one now would stop an installed app from booting
  // on upgrade, over a declaration that was correct when it was written.
  it("drops a plugin's publish on a collection instead of throwing", () => {
    const out = collectCustomPermissions(cfg(["posts"]), [
      plugin("@acme/workflow", [{ action: "publish", resource: "posts" }]),
    ]);

    expect(out).toEqual([]);
  });

  it("drops one declared with a different case, as the seeder does", () => {
    // The seeder compares in lower case, because `ensurePermission` matches an existing row that
    // way. Left case-sensitive here, `Publish` survives collection while the seeder withholds it,
    // so codegen and role bundles go on referencing a slug that is never seeded under that name.
    const out = collectCustomPermissions(cfg(["posts"]), [
      plugin("@acme/workflow", [{ action: "Publish", resource: "posts" }]),
    ]);

    expect(out).toEqual([]);
  });

  it("drops one whose RESOURCE differs in case too", () => {
    // The seeder lowercases both halves. With only the action normalised here, `Publish-Posts`
    // survives collection while the seeder withholds `publish:posts` — so role bundles and
    // generated types reference a slug that is never seeded.
    const out = collectCustomPermissions(cfg(["posts"]), [
      plugin("@acme/workflow", [{ action: "Publish", resource: "Posts" }]),
    ]);

    expect(out).toEqual([]);
  });

  it("derives the slug from the identity exactly as declared", () => {
    // `parsePermissionSlug` turns a route guard's slug back into an action and a resource, and
    // `hasPermission` matches those with `eq()`. A slug composed from a normalized copy of the
    // identity no longer round-trips to the row it names, so a role holding the grant is denied
    // by the guard that asks for it.
    const out = collectCustomPermissions(cfg(), [
      plugin("@acme/workflow", [{ action: "Export", resource: "Reports" }]),
    ]);

    expect(out.map(p => p.slug)).toEqual(["Export-Reports"]);
  });

  it("drops unpublish on a collection too", () => {
    const out = collectCustomPermissions(cfg(["posts"]), [
      plugin("@acme/workflow", [{ action: "unpublish", resource: "posts" }]),
    ]);

    expect(out).toEqual([]);
  });

  it("drops them on a single as well", () => {
    const out = collectCustomPermissions(cfg([], ["site-settings"]), [
      plugin("@acme/workflow", [
        { action: "publish", resource: "site-settings" },
      ]),
    ]);

    expect(out).toEqual([]);
  });

  it("still collects publish on a resource that is not an entity", () => {
    // Nothing seeds `publish-newsletter`, so it remains a real custom
    // permission — the adoption is scoped to slugs the seeder owns.
    const out = collectCustomPermissions(cfg(["posts"]), [
      plugin("@acme/news", [{ action: "publish", resource: "newsletter" }]),
    ]);

    expect(out).toHaveLength(1);
    expect(out[0].slug).toBe("publish-newsletter");
  });

  it("still throws for a CRUD verb, which was never a plugin's to declare", () => {
    // The adoption is not a general amnesty: `update-posts` has always been
    // the seeder's, so declaring it remains an authoring error.
    expect(() =>
      collectCustomPermissions(cfg(["posts"]), [
        plugin("@acme/x", [{ action: "update", resource: "posts" }]),
      ])
    ).toThrow();
  });

  it("does not let a dropped declaration mask a genuine duplicate", () => {
    // A dropped `publish:posts` sits alongside a real duplicate on a resource
    // nothing seeds. Skipping the first must not consume or excuse the second.
    expect(() =>
      collectCustomPermissions(cfg(["posts"]), [
        plugin("@acme/legacy", [{ action: "publish", resource: "posts" }]),
        plugin("@acme/a", [{ action: "publish", resource: "newsletter" }]),
        plugin("@acme/b", [{ action: "publish", resource: "newsletter" }]),
      ])
    ).toThrow();
  });

  it("does not register a dropped declaration as seen", () => {
    // The drop happens before `seen` is written, so a later declaration of the
    // same pair on a non-entity resource is not mistaken for a duplicate of it.
    const out = collectCustomPermissions(cfg(["posts"]), [
      plugin("@acme/legacy", [{ action: "publish", resource: "posts" }]),
      plugin("@acme/news", [{ action: "publish", resource: "newsletter" }]),
    ]);

    expect(out.map(p => p.slug)).toEqual(["publish-newsletter"]);
  });
});

/**
 * The collision code and reason a refusal carries.
 *
 * Asserted instead of the message: the public message is one sentence for every collision, so a
 * test matching on it passes for a duplicate-permission refusal as readily as for this one.
 */
function collisionOf(run: () => void): { code: string; reason: unknown } {
  try {
    run();
  } catch (error) {
    const err = error as { code?: string; logContext?: { reason?: unknown } };
    return { code: err.code ?? "", reason: err.logContext?.reason };
  }
  throw new Error("expected a collision, and nothing was thrown");
}

describe("a CRUD collision the config cannot see", () => {
  const declaring = (action: string, resource: string) =>
    collectUnresolvedPermissionTargets(cfg(["posts"]), [
      plugin("@acme/reports", [{ action, resource }]),
    ]);

  it("defers a CRUD action on a resource the config does not define", () => {
    // It may be a Builder collection or a resource the plugin owns outright. Both look the same
    // here, so neither is refused yet.
    expect(declaring("delete", "reports")).toEqual([
      { action: "delete", resource: "reports", owner: "@acme/reports" },
    ]);
  });

  it("defers a case-mismatched one too, since the seeder compares in lower case", () => {
    expect(declaring("Delete", "Reports")).toHaveLength(1);
  });

  it("does not defer a resource the config already settled", () => {
    // `collectCustomPermissions` threw on it, or allowed it; either way the answer is in.
    expect(declaring("delete", "posts")).toEqual([]);
  });

  it("does not defer a non-CRUD action, which no seeder owns", () => {
    expect(declaring("export", "reports")).toEqual([]);
  });

  it("refuses the declaration once the resource is known to be a Builder entity", () => {
    const unresolved = declaring("delete", "reports");

    expect(
      collisionOf(() => finalizePermissionTargets(unresolved, ["reports"]))
    ).toEqual({
      code: "NEXTLY_PERMISSION_COLLISION",
      reason: "crud-permission-reserved",
    });
  });

  it("refuses it whatever case the declaration used", () => {
    expect(
      collisionOf(() =>
        finalizePermissionTargets(declaring("Delete", "Reports"), ["reports"])
      ).reason
    ).toBe("crud-permission-reserved");
  });

  it("allows a resource no entity claims, which is the ordinary custom permission", () => {
    expect(() =>
      finalizePermissionTargets(declaring("delete", "reports"), ["invoices"])
    ).not.toThrow();
  });

  it("warns instead of refusing only when an application opts in", () => {
    const warnings: string[] = [];

    expect(() =>
      finalizePermissionTargets(declaring("delete", "reports"), ["reports"], {
        allowOverride: true,
        logger: { warn: message => warnings.push(message) },
      })
    ).not.toThrow();
    // Silence would leave an application running with a permission taken from its own editors and
    // nothing saying so.
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("@acme/reports");
  });
});

describe("a CRUD collision on a config entity", () => {
  it("is refused whatever case the action was declared in", () => {
    // `ensurePermission` matches an existing row with `LOWER(action) = LOWER(action)`, so a
    // capitalised action reaches the same row — and reached it without passing this check.
    expect(
      collisionOf(() =>
        collectCustomPermissions(cfg(["posts"]), [
          plugin("@acme/x", [{ action: "Delete", resource: "Posts" }]),
        ])
      ).reason
    ).toBe("crud-permission-reserved");
  });
});

/**
 * The seeder matches an existing row with `LOWER(action)` and `LOWER(resource)`,
 * so two declarations differing only by case are ONE row in the database. The
 * collector has to agree, or two owners both claim a permission the database
 * attributes to whichever was seeded last.
 */
describe("collectCustomPermissions — identity is case-insensitive", () => {
  it("rejects two declarations that differ only by case", () => {
    expect(() =>
      collectCustomPermissions({}, [
        {
          name: "@acme/a",
          version: "1.0.0",
          contributes: {
            permissions: [{ action: "Export", resource: "Reports" }],
          },
        },
        {
          name: "@acme/b",
          version: "1.0.0",
          contributes: {
            permissions: [{ action: "export", resource: "reports" }],
          },
        },
      ] as unknown as PluginDefinition[])
    ).toThrow();
  });

  /**
   * The control: identities that genuinely differ still both collect, so the
   * rejection above is about the case-folded collision and not about the
   * collector having become intolerant of two plugins declaring permissions.
   */
  it("still collects two genuinely distinct identities", () => {
    const out = collectCustomPermissions({}, [
      {
        name: "@acme/a",
        version: "1.0.0",
        contributes: {
          permissions: [{ action: "Export", resource: "Reports" }],
        },
      },
      {
        name: "@acme/b",
        version: "1.0.0",
        contributes: {
          permissions: [{ action: "export", resource: "invoices" }],
        },
      },
    ] as unknown as PluginDefinition[]);

    expect(out.map(p => p.slug)).toEqual(["Export-Reports", "export-invoices"]);
  });
});
