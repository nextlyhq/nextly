/**
 * `contributes.admin.styles` declares a plugin's precompiled admin CSS so the
 * plugin doctor and tooling can reason about styling without executing the
 * plugin. Optional; accepts one path or several.
 */
import { describe, expect, it } from "vitest";

import type { PluginAdminContributions } from "../admin-contributions";

describe("contributes.admin.styles", () => {
  it("accepts a single path", () => {
    const admin: PluginAdminContributions = {
      styles: "@acme/plugin/dist/admin.css",
    };
    expect(admin.styles).toBe("@acme/plugin/dist/admin.css");
  });

  it("accepts an array of paths", () => {
    const admin: PluginAdminContributions = {
      styles: ["@a/x/admin.css", "@a/y/admin.css"],
    };
    expect(Array.isArray(admin.styles)).toBe(true);
  });

  it("is optional (unstyled plugins omit it)", () => {
    const admin: PluginAdminContributions = { menu: [] };
    expect(admin.styles).toBeUndefined();
  });
});
