import { describe, expect, it } from "vitest";

import type { NextlyServiceConfig } from "../../di/register";
import type { PluginDefinition } from "../plugin-context";

import { collectRoles } from "./collect-roles";

const cfg = (roles: unknown[] = []): NextlyServiceConfig =>
  ({ roles, plugins: [] }) as unknown as NextlyServiceConfig;

const plugin = (name: string, roles: unknown[]): PluginDefinition =>
  ({
    name,
    version: "1.0.0",
    contributes: { roles },
  }) as unknown as PluginDefinition;

describe("collectRoles", () => {
  it("folds app + plugin roles with owner provenance", () => {
    const out = collectRoles(
      cfg([{ slug: "app-role", name: "App", permissionSlugs: ["read-x"] }]),
      [
        plugin("@a/p", [
          { slug: "p-role", name: "P", permissionSlugs: ["read-y"] },
        ]),
      ]
    );
    expect(out.map(r => r.slug)).toEqual(["app-role", "p-role"]);
    expect(out.find(r => r.slug === "p-role")?.owner).toBe("@a/p");
    expect(out.find(r => r.slug === "app-role")?.owner).toBe("app");
  });

  it("throws on a duplicate slug across sources", () => {
    expect(() =>
      collectRoles(cfg([{ slug: "dup", name: "A", permissionSlugs: [] }]), [
        plugin("@a/p", [{ slug: "dup", name: "B", permissionSlugs: [] }]),
      ])
    ).toThrow(/dup/);
  });

  it("throws on a reserved system role slug (super-admin)", () => {
    expect(() =>
      collectRoles(cfg(), [
        plugin("@a/p", [
          { slug: "super-admin", name: "X", permissionSlugs: [] },
        ]),
      ])
    ).toThrow(/super-admin/);
  });

  it("returns [] when nothing declares roles", () => {
    expect(collectRoles(cfg(), [])).toEqual([]);
  });
});
