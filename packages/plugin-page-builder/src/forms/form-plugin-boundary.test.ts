/**
 * The Form block and the page builder know nothing of the forms plugin.
 *
 * Every rule about the forms plugin's forms lives in its provider, which it
 * registers through the page builder's `forms` service; the two meet only
 * in the contract `@nextlyhq/plugin-sdk/blocks` declares. So neither package
 * names the forms plugin: not in its manifest, where pnpm would make it
 * importable, and not in any import or `require` in its source.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = fileURLToPath(import.meta.url);
const PACKAGES = resolve(dirname(HERE), "../../..");
const FORMS_PLUGIN = "@nextlyhq/plugin-form-builder";

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

/** Whether `specifier` reaches the forms plugin, by its name or its folder. */
const reachesFormsPlugin = (specifier: string): boolean =>
  specifier.startsWith(FORMS_PLUGIN) ||
  specifier.includes("plugin-form-builder/");

describe.each(["plugin-page-builder", "blocks-react"])("%s", name => {
  const root = join(PACKAGES, name);

  it("does not depend on the forms plugin", () => {
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
        FORMS_PLUGIN
      );
    }
  });

  it("imports nothing from the forms plugin", () => {
    const files = sourceFiles(join(root, "src"));
    // The walk really reads the package: a wrong root finds no file and
    // would pass on nothing.
    expect(files.length).toBeGreaterThan(50);
    // This file names the plugin in its own control below, and only there.
    const reaching = files.filter(
      file =>
        file !== HERE &&
        specifiersOf(readFileSync(file, "utf8")).some(reachesFormsPlugin)
    );
    expect(reaching).toEqual([]);
  });
});

describe("the import scan", () => {
  it("finds each way a module names another", () => {
    // The positive control: every assertion above passes by finding nothing.
    const found = specifiersOf(
      [
        `import { a } from "${FORMS_PLUGIN}";`,
        `export * from '${FORMS_PLUGIN}/admin';`,
        `const b = await import("../../plugin-form-builder/src/x");`,
        `const c = require("${FORMS_PLUGIN}");`,
        `import "${FORMS_PLUGIN}/styles.css";`,
      ].join("\n")
    );
    expect(found.filter(reachesFormsPlugin)).toHaveLength(5);
  });
});
