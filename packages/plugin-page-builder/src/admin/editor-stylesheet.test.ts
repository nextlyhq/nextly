/**
 * The admin entry brings the editor's stylesheet with the parts it styles.
 *
 * An app reaches `./admin` through the component map `nextly generate:types`
 * writes, wherever the plugin is configured. So the plugin loading its own
 * sheet is what makes configuring the plugin enough; without it, every app had
 * to add the import to its admin page by hand, and one that missed the step got
 * an unstyled builder and no error. The entry itself imports no sheet: it
 * fetches `editor-stylesheet.ts` with the parts that need it, so a screen
 * drawing none of them downloads none of it (`entry-loads-registration-only`).
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
const SOURCE_DIR = resolve(PACKAGE_DIR, "src");
const EDITOR_CSS = resolve(PACKAGE_DIR, "src/styles/editor.css");

/** The specifiers a module imports for their side effect alone. */
function sideEffectImportsIn(source: string): string[] {
  return [...source.matchAll(/^import\s+"([^"]+)";/gm)].map(
    match => match[1] as string
  );
}

/** The specifiers an admin module imports for their side effect alone. */
function sideEffectImports(file: string): string[] {
  return sideEffectImportsIn(readFileSync(join(ADMIN_DIR, file), "utf8"));
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

describe("the admin's stylesheet", () => {
  it("is imported by the stylesheet module, the editor stylesheet the package ships", () => {
    const sheets = sideEffectImports("editor-stylesheet.ts")
      .filter(specifier => specifier.endsWith(".css"))
      .map(specifier => resolve(ADMIN_DIR, specifier));

    expect(sheets).toEqual([EDITOR_CSS]);
  });

  it("is not imported by the entry itself", () => {
    expect(
      sideEffectImports("index.ts").filter(specifier =>
        specifier.endsWith(".css")
      )
    ).toEqual([]);
  });

  it("reaches the published copy once built", () => {
    // The build emits the stylesheet module as a chunk wherever it places it,
    // rewriting the relative import from there, and copies `src/styles` to
    // `dist/styles`. So the import lands on the shipped file only if the
    // sheet sits under `dist` where it sits under `src`. Read from the export
    // map, so a move of the published sheet fails here rather than in an app.
    const fromSource = relative(SOURCE_DIR, EDITOR_CSS);
    const fromBuild = relative(
      resolve(PACKAGE_DIR, "dist"),
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
