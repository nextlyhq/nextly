/**
 * The admin entry loads the editor's stylesheet itself.
 *
 * An app reaches `./admin` through the component map `nextly generate:types`
 * writes, wherever the plugin is configured. So the entry importing its own
 * sheet is what makes configuring the plugin enough; without it, every app had
 * to add the import to its admin page by hand, and one that missed the step got
 * an unstyled builder and no error.
 *
 * Asserted over the source and the build's own configuration rather than by
 * rendering: jsdom applies no stylesheet, so a render here would pass whatever
 * the entry imported. What a real bundler does with the import is checked in a
 * browser, on a fresh project.
 *
 * @module admin/editor-stylesheet.test
 */
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import config from "../../tsdown.config";

const ADMIN_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = resolve(ADMIN_DIR, "../..");
const EDITOR_CSS = resolve(PACKAGE_DIR, "src/styles/editor.css");

/** The specifiers a module imports for their side effect alone. */
function sideEffectImportsIn(source: string): string[] {
  return [...source.matchAll(/^import\s+"([^"]+)";/gm)].map(
    match => match[1] as string
  );
}

/** The specifiers the admin entry imports for their side effect alone. */
function sideEffectImports(): string[] {
  return sideEffectImportsIn(readFileSync(join(ADMIN_DIR, "index.ts"), "utf8"));
}

/** Where the package publishes the editor stylesheet, from its export map. */
function exportedStylesheet(): string {
  const manifest = JSON.parse(
    readFileSync(join(PACKAGE_DIR, "package.json"), "utf8")
  ) as { exports: Record<string, unknown> };
  const target = manifest.exports["./styles/editor.css"];
  if (typeof target !== "string") {
    throw new Error("the package exports no ./styles/editor.css");
  }
  return target;
}

describe("the admin entry's stylesheet", () => {
  it("imports the editor stylesheet the package ships", () => {
    const sheets = sideEffectImports()
      .filter(specifier => specifier.endsWith(".css"))
      .map(specifier => resolve(ADMIN_DIR, specifier));

    expect(sheets).toEqual([EDITOR_CSS]);
  });

  it("reaches the published copy by the same path once built", () => {
    // The build copies `src/styles` to `dist/styles` and emits this entry as
    // `dist/admin/index.js`, so the relative import only lands on the shipped
    // file if the two layouts mirror each other. Read from the export map, so
    // a move of the published sheet fails here rather than in an app.
    const fromSource = relative(ADMIN_DIR, EDITOR_CSS);
    const fromBuild = relative(
      resolve(PACKAGE_DIR, "dist/admin"),
      resolve(PACKAGE_DIR, exportedStylesheet())
    );

    expect(fromBuild).toBe(fromSource);
  });

  it("is left as an import by the build, for the app's bundler to load", () => {
    // Bundled, the import would be rewritten or dropped and the copied sheet,
    // whose `@import` of the builder's own sheet the app's bundler resolves,
    // would never be loaded.
    const external = [config]
      .flat()
      .flatMap(entry => [entry.external ?? []].flat());
    const keeps = (specifier: string) =>
      external.some(rule =>
        rule instanceof RegExp ? rule.test(specifier) : rule === specifier
      );

    expect(keeps("../styles/editor.css")).toBe(true);
  });

  it("CONTROL: the reader finds a side-effect import, and only those", () => {
    // Asked of a known sample, so it holds whatever the entry imports: a
    // pattern that matched nothing would make the first case fail for the
    // wrong reason, and one that matched named imports would let a stylesheet
    // brought in some other way stand in for the entry importing it.
    const sample = [
      '"use client";',
      'import { a } from "./a";',
      'import "./side-effect.css";',
      'import type { B } from "./b";',
    ].join("\n");
    expect(sideEffectImportsIn(sample)).toEqual(["./side-effect.css"]);
  });
});
