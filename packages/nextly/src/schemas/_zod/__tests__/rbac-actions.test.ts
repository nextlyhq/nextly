/**
 * The permission action vocabulary.
 *
 * Publishing is a separate capability from editing: a role that may change a
 * document is not automatically one that may put it in front of the public.
 *
 * The action list is duplicated across the seeder, the plugin reservation sets
 * and codegen, so these assertions pin the two ends that a drift would break —
 * a slug the app seeds but the generated types deny, or one a plugin can claim
 * from underneath the seeder.
 */
import { describe, it, expect } from "vitest";

import type { NextlyServiceConfig } from "../../../di/register";
import { collectCodegenNames } from "../../../plugins/codegen/collect-codegen-names";
import { PermissionActionSchema } from "../rbac";

function cfg(partial: Record<string, unknown>): NextlyServiceConfig {
  return partial as unknown as NextlyServiceConfig;
}

describe("PermissionActionSchema", () => {
  it("accepts the publish lifecycle actions", () => {
    expect(PermissionActionSchema.parse("publish")).toBe("publish");
    expect(PermissionActionSchema.parse("unpublish")).toBe("unpublish");
  });

  it("still accepts the CRUD actions and manage", () => {
    for (const action of ["create", "read", "update", "delete", "manage"]) {
      expect(PermissionActionSchema.parse(action)).toBe(action);
    }
  });

  it("rejects an action outside the vocabulary", () => {
    expect(() => PermissionActionSchema.parse("archive")).toThrow();
  });

  it("names the accepted actions in its error message", () => {
    // What an operator sees after a typo in a config file.
    const result = PermissionActionSchema.safeParse("publsh");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("publish");
      expect(result.error.issues[0].message).toContain("unpublish");
    }
  });
});

describe("generated permission slugs cover the publish lifecycle", () => {
  // Codegen derives its slug union from its own copy of the seeder's action
  // lists. Asserting the generated output rather than the constants means the
  // test fails on the drift itself, not on how the lists happen to be spelled.
  it("emits publish and unpublish slugs for a collection", () => {
    const { permissionSlugs } = collectCodegenNames(
      cfg({ collections: [{ slug: "posts" }], singles: [] }),
      []
    );

    expect(permissionSlugs).toEqual(
      expect.arrayContaining(["publish-posts", "unpublish-posts"])
    );
  });

  it("emits them for a single too", () => {
    // A Single carries the same status column and is published by an ordinary
    // update, so it needs the same permissions a collection does.
    const { permissionSlugs } = collectCodegenNames(
      cfg({ collections: [], singles: [{ slug: "site-settings" }] }),
      []
    );

    expect(permissionSlugs).toEqual(
      expect.arrayContaining([
        "publish-site-settings",
        "unpublish-site-settings",
      ])
    );
    // Still no create/delete for a single — publishing does not imply a
    // lifecycle it does not have.
    expect(permissionSlugs).not.toContain("create-site-settings");
    expect(permissionSlugs).not.toContain("delete-site-settings");
  });

  it("emits only actions the schema accepts", () => {
    const { permissionSlugs } = collectCodegenNames(
      cfg({
        collections: [{ slug: "posts" }],
        singles: [{ slug: "site-settings" }],
      }),
      []
    );

    for (const slug of permissionSlugs) {
      // Slugs are `${action}-${resource}`; the resource may itself contain
      // hyphens, so only the first segment is the action.
      const action = slug.slice(0, slug.indexOf("-"));
      expect(() => PermissionActionSchema.parse(action)).not.toThrow();
    }
  });
});
