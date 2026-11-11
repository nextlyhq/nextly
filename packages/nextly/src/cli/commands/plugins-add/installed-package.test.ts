/**
 * Finding the package `nextly plugins add` installed: its name from what was
 * typed, its folder as Node resolves a bare name from the project, and the
 * entry an `import` of it loads.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  entryFileOf,
  findInstalledPackage,
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

  it("loads the entry its exports give an import, in the order they are written", () => {
    const dir = "/p";
    expect(
      entryFileOf(dir, {
        exports: {
          ".": {
            types: "./dist/index.d.ts",
            import: "./dist/index.js",
            default: "./dist/index.cjs",
          },
        },
      })
    ).toBe(join(dir, "dist/index.js"));
    expect(
      entryFileOf(dir, {
        exports: { require: "./a.cjs", default: "./a.mjs" },
      })
    ).toBe(join(dir, "a.mjs"));
    expect(
      entryFileOf(dir, {
        exports: { ".": { node: { import: "./n.mjs" }, default: "./d.js" } },
      })
    ).toBe(join(dir, "n.mjs"));
    expect(entryFileOf(dir, { exports: "./e.js" })).toBe(join(dir, "e.js"));
    // Node matches `node-addons` by default, as it does `node`.
    expect(
      entryFileOf(dir, { exports: { ".": { "node-addons": "./native.js" } } })
    ).toBe(join(dir, "native.js"));
  });

  it("without exports, loads main as Node does, trying its extensions, and never module", async () => {
    const dir = join(project, "legacy");
    await mkdir(join(dir, "dist", "lib"), { recursive: true });
    await writeFile(join(dir, "dist", "index.js"), "");
    await writeFile(join(dir, "dist", "lib", "index.js"), "");
    await writeFile(join(dir, "index.js"), "");
    expect(entryFileOf(dir, { main: "./dist/index" })).toBe(
      join(dir, "dist", "index.js")
    );
    expect(entryFileOf(dir, { main: "./dist/lib" })).toBe(
      join(dir, "dist", "lib", "index.js")
    );
    expect(
      entryFileOf(dir, { module: "./dist/index.js", main: "./nowhere" })
    ).toBe(join(dir, "index.js"));
    expect(entryFileOf(dir, {})).toBe(join(dir, "index.js"));
  });
});
