import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { BUNDLED_TEMPLATES } from "../lib/bundled-templates";

import {
  getAvailableTemplateNames,
  getTemplate,
  shouldUseBundledTemplate,
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

describe("shouldUseBundledTemplate", () => {
  // The bundled copy ships inside the CLI, so it matches the packages this CLI
  // release installs; a GitHub `main` copy can run ahead of them.
  it.each(["blank", "plugin"])(
    "uses the bundled '%s' template by default",
    name => {
      expect(shouldUseBundledTemplate(name, {})).toBe(true);
    }
  );

  it("resolves content templates live, since they are not bundled", () => {
    expect(shouldUseBundledTemplate("blog", {})).toBe(false);
  });

  // Each of these names a template source explicitly, so the bundled copy
  // would silently ignore what the developer asked for.
  it.each([
    ["--local-template", { localTemplatePath: "/tmp/templates" }],
    ["--use-yalc", { useYalc: true }],
    ["a --branch", { branch: "release" }],
    // With no default any more, `--branch main` is a source asked for too:
    // it takes the template on main, not this release's.
    ["--branch main", { branch: "main" }],
  ])("resolves live when %s is given", (_label, options) => {
    expect(shouldUseBundledTemplate("blank", options)).toBe(false);
    expect(shouldUseBundledTemplate("plugin", options)).toBe(false);
  });
});

// The build copies BUNDLED_TEMPLATES into the package and the CLI copies from
// that copy, so a name there that is not a template directory is a scaffold
// that fails only once published.
describe("BUNDLED_TEMPLATES", () => {
  const templatesRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../templates"
  );

  it.each([...BUNDLED_TEMPLATES])("names a template directory: %s", name => {
    expect(existsSync(path.join(templatesRoot, name))).toBe(true);
  });

  it("lists only registered templates, besides the shared base", () => {
    for (const name of BUNDLED_TEMPLATES) {
      if (name === "base") continue;
      expect(getAvailableTemplateNames()).toContain(name);
    }
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

/**
 * A complete caret version (`^1.2.3`, `^0.0.2-alpha.66`) or the open range.
 * Anything else, a dist-tag above all, is an invalid peer spec: pnpm 11 then
 * refuses to run any script in the scaffold, `pnpm dev` included.
 */
const VALID_PEER_RANGE = /^(?:\^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?|>=0\.0\.0)$/;

describe("plugin peer dependency ranges", () => {
  beforeAll(() => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline test")));
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  // Offline, and under --use-yalc, no version is resolved and every range
  // falls back to the channel's dist-tag, which is valid for an install but
  // not for a peer.
  it.each([
    ["offline", false],
    ["under --use-yalc", true],
  ])("declares only semver ranges as peers %s", async (_label, useYalc) => {
    const pkg = JSON.parse(
      await generatePackageJson(
        "@acme/nextly-plugin-x",
        { type: "sqlite" as DatabaseType } as never,
        useYalc,
        "plugin"
      )
    );

    for (const [name, range] of Object.entries(pkg.peerDependencies)) {
      expect(range, `peer ${name}`).toMatch(VALID_PEER_RANGE);
    }
  });
});
