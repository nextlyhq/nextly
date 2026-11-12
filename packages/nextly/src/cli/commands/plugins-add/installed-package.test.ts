/**
 * Finding the package `nextly plugins add` installed: its name from what was
 * typed, its folder as Node resolves a bare name from the project, and the
 * entry an `import` of it loads.
 */
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  findInstalledPackage,
  importEntry,
  packageNameOf,
} from "./installed-package";

describe("the package name in what was typed", () => {
  it.each([
    ["@acme/seo", "@acme/seo"],
    ["@acme/seo@^1.2.0", "@acme/seo"],
    ["@acme/seo@alpha", "@acme/seo"],
    ["seo-plugin", "seo-plugin"],
    ["seo-plugin@1.0.0", "seo-plugin"],
  ])("%s is %s", (spec, name) => {
    expect(packageNameOf(spec)).toBe(name);
  });
});

describe("the installed package", () => {
  let project: string;

  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), "nextly-plugins-add-pkg-"));
  });

  afterEach(async () => {
    await rm(project, { recursive: true, force: true });
  });

  async function install(at: string, manifest: object): Promise<string> {
    const dir = join(at, "node_modules", "@acme", "seo");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "package.json"), JSON.stringify(manifest));
    return dir;
  }

  it("is found in the project's node_modules, or a folder above it", async () => {
    const dir = await install(project, { name: "@acme/seo" });
    const app = join(project, "apps", "site");
    await mkdir(app, { recursive: true });
    expect(await findInstalledPackage(app, "@acme/seo")).toEqual({
      dir,
      manifest: { name: "@acme/seo" },
    });
    expect(await findInstalledPackage(app, "@acme/other")).toBeUndefined();
  });

  /** A package at `@acme/seo`, its manifest and its files, in the project. */
  async function installWith(
    manifest: object,
    files: Record<string, string>
  ): Promise<void> {
    const dir = await install(project, { name: "@acme/seo", ...manifest });
    for (const [file, text] of Object.entries(files)) {
      await mkdir(join(dir, file, ".."), { recursive: true });
      await writeFile(join(dir, file), text);
    }
  }

  it("imports the entry Node resolves, whichever of Node's conditions names it", async () => {
    // `module-sync`, which Node matches by default as it does `import`.
    await installWith(
      { exports: { ".": { "module-sync": "./plugin.js" } }, type: "module" },
      { "plugin.js": 'export const seoPlugin = "module-sync";' }
    );
    expect(await importEntry(project, "@acme/seo")).toEqual({
      seoPlugin: "module-sync",
    });
  });

  it("imports what an import is given, not what a require is", async () => {
    await installWith(
      {
        type: "module",
        exports: { ".": { require: "./a.cjs", import: "./a.js" } },
      },
      {
        "a.cjs": 'module.exports = { seoPlugin: "require" };',
        "a.js": 'export const seoPlugin = "import";',
      }
    );
    expect(await importEntry(project, "@acme/seo")).toEqual({
      seoPlugin: "import",
    });
  });

  it("without exports, imports main as Node does, trying its extensions", async () => {
    await installWith(
      { main: "./dist/index", type: "module" },
      { "dist/index.js": 'export const seoPlugin = "main";' }
    );
    expect(await importEntry(project, "@acme/seo")).toEqual({
      seoPlugin: "main",
    });
  });

  it("finds a package installed above the project from a relative folder", async () => {
    const dir = await install(project, { name: "@acme/seo" });
    const app = join(project, "apps", "site");
    await mkdir(app, { recursive: true });
    const before = process.cwd();
    process.chdir(app);
    try {
      expect((await findInstalledPackage(".", "@acme/seo"))?.dir).toBe(
        await realpath(dir)
      );
    } finally {
      process.chdir(before);
    }
  });

  it("resolves with the conditions Node was started with", async () => {
    await installWith(
      { exports: { ".": { site: "./site.js" } }, type: "module" },
      { "site.js": 'export const seoPlugin = "site";' }
    );
    expect(
      await importEntry(project, "@acme/seo", {
        execArgv: ["--conditions=site"],
      })
    ).toEqual({ seoPlugin: "site" });
    // Without it Node finds no entry an import may load.
    await expect(
      importEntry(project, "@acme/seo", { execArgv: [] })
    ).rejects.toMatchObject({ code: "PLUGIN_REGISTRATION_UNKNOWN" });
  });

  it("refuses, naming why, a package Node cannot load from the project", async () => {
    await installWith({ exports: { ".": { browser: "./b.js" } } }, {});
    await expect(importEntry(project, "@acme/seo")).rejects.toMatchObject({
      code: "PLUGIN_REGISTRATION_UNKNOWN",
    });
  });
});
