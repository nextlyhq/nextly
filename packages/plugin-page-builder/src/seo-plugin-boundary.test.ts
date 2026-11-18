/**
 * The page builder and the builder know nothing of the SEO plugin. The SEO
 * plugin's page checks live in its own provider, which it registers through
 * the page builder's `pageChecks` service; the two meet only in the contract
 * `@nextlyhq/plugin-sdk/blocks` declares. So neither package names the SEO
 * plugin: not in its manifest, where pnpm would make it importable, and not
 * in any import or `require` in its source.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = fileURLToPath(import.meta.url);
const PACKAGES = resolve(dirname(HERE), "../..");
const SEO_PLUGIN = "@nextlyhq/plugin-seo";

/** Every source file under `dir`, tests included. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter(entry => entry.isFile() && /\.(?:[cm]?[jt]sx?)$/.test(entry.name))
    .map(entry => join(entry.parentPath, entry.name));
}

/** The module specifiers `code` imports, re-exports or requires. */
function specifiersOf(code: string): string[] {
  return [
    ...code.matchAll(
      /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["'`]([^"'`]+)["'`]/g
    ),
  ].map(match => match[1]);
}

/** Whether `specifier` reaches the SEO plugin, by its name or its folder. */
const reachesSeoPlugin = (specifier: string | undefined): boolean =>
  specifier !== undefined &&
  (specifier.startsWith(SEO_PLUGIN) || specifier.includes("plugin-seo/"));

describe.each(["plugin-page-builder", "builder"])("%s", name => {
  const root = join(PACKAGES, name);

  it("does not depend on the SEO plugin", () => {
    const manifest = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8")
    ) as Record<string, Record<string, string> | undefined>;
    for (const field of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ]) {
      expect(Object.keys(manifest[field] ?? {}), field).not.toContain(
        SEO_PLUGIN
      );
    }
  });

  it("imports nothing from the SEO plugin", () => {
    const files = sourceFiles(join(root, "src"));
    // The walk really reads the package: a wrong root finds no file and
    // would pass on nothing.
    expect(files.length).toBeGreaterThan(50);
    const reaching = files.filter(
      file =>
        file !== HERE &&
        specifiersOf(readFileSync(file, "utf8")).some(reachesSeoPlugin)
    );
    expect(reaching).toEqual([]);
  });
});

describe("the import scan", () => {
  it("finds each way a module names the SEO plugin", () => {
    // The positive control: every assertion above passes by finding nothing.
    const found = specifiersOf(
      [
        `import { a } from "${SEO_PLUGIN}";`,
        `export * from "${SEO_PLUGIN}/admin";`,
        `const b = await import("${SEO_PLUGIN}");`,
        `const c = require("../../plugin-seo/src/x");`,
      ].join("\n")
    );
    expect(found.filter(reachesSeoPlugin)).toHaveLength(4);
  });
});
