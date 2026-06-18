import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  getAvailableTemplateNames,
  getTemplate,
  templateHasApproaches,
  templateHasDemoData,
} from "../lib/templates";
import type { DatabaseType } from "../types";
import { generatePackageJson } from "../utils/template";

describe("plugin template registration (D44)", () => {
  it("is listed among available templates", () => {
    expect(getAvailableTemplateNames()).toContain("plugin");
  });

  it("has the plugin-specific manifest shape", () => {
    const plugin = getTemplate("plugin");
    expect(plugin).toBeDefined();
    expect(plugin?.name).toBe("plugin");
    // Plugins don't ask code-first vs visual, ship no app frontend, no demo data,
    // and bring their own collections.
    expect(plugin?.approaches).toEqual([]);
    expect(plugin?.defaultApproach).toBeNull();
    expect(plugin?.hasFrontendPages).toBe(false);
    expect(plugin?.hasDemoData).toBe(false);
    expect(plugin?.collections).toEqual([]);
  });

  it("skips approach + demo-data prompts", () => {
    expect(templateHasApproaches("plugin")).toBe(false);
    expect(templateHasDemoData("plugin")).toBe(false);
  });
});

describe("plugin package.json generation (D44/D45)", () => {
  // Stub the network so version resolution is fast + deterministic (→ ranges
  // fall back; we assert STRUCTURE, not exact versions).
  beforeAll(() => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline test")));
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("produces a publishable library package.json (not an app)", async () => {
    const pkg = JSON.parse(
      await generatePackageJson(
        "@acme/nextly-plugin-x",
        { type: "sqlite" as DatabaseType } as never,
        false,
        "plugin"
      )
    );

    // Library entry points.
    expect(pkg.name).toBe("@acme/nextly-plugin-x");
    expect(pkg.main).toBe("./dist/index.mjs");
    expect(pkg.types).toBe("./dist/index.d.ts");
    expect(pkg.exports["."]).toBeDefined();
    expect(pkg.exports["./admin"]).toBeDefined();
    // Only dist/ ships — the embedded dev/ playground is never published.
    expect(pkg.files).toEqual(["dist"]);
    // Discoverable + peer-dep'd on the host.
    expect(pkg.keywords).toContain("nextly-plugin");
    expect(Object.keys(pkg.peerDependencies)).toEqual(
      expect.arrayContaining([
        "nextly",
        "@nextlyhq/admin",
        "@nextlyhq/plugin-sdk",
        "react",
      ])
    );
    // Scripts cover build + the dev playground + test.
    expect(pkg.scripts.build).toBe("tsup");
    expect(pkg.scripts.dev).toContain("next dev dev");
    expect(pkg.scripts.test).toBe("vitest run");
    // Not an app: no Next.js `start`/`db:migrate` app scripts, not private.
    expect(pkg.scripts.start).toBeUndefined();
    expect(pkg.dependencies).toBeUndefined();
  });
});
