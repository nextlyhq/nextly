import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { importedSpecifiers } from "@nextlyhq/module-specifiers";
import { describe, expect, it } from "vitest";

import { collectModules } from "./source-modules";

/**
 * Which colour implementation the editor is allowed to reach.
 *
 * There are FOUR colour concerns in this repository and they are not
 * interchangeable:
 *
 * - `checkColorValue` in `blocks-engine` — is this a valid CSS colour. The
 *   canonical grammar check, reached through `validateStyleValues`.
 * - `@nextlyhq/ui`'s `lib/color` — sRGB/HSV/OKLCH conversion for the picker
 *   widget's own geometry. No accessibility maths at all.
 * - `blocks-engine`'s `style/contrast.ts` — WCAG 2 contrast, dependency-free,
 *   written for "tokens a person is choosing right now".
 * - `@nextlyhq/ui`'s `styles/contrast` — WCAG 2 contrast for the ADMIN THEME,
 *   built on `culori` and `postcss` and checked once in CI against a stylesheet.
 *
 * The last two compute the same two formulas and are deliberately unshared:
 * importing ui's into the engine would end the engine's runtime-free guarantee,
 * and importing the engine's into ui would point the design system at the page
 * builder. They agree because both are anchored to the specification's own
 * reference values, not because either defers to the other.
 *
 * **A control's contrast readout therefore calls the ENGINE's.** It is the one
 * that answers while a picker is open, and it is the one the compiler already
 * shares.
 *
 * ## What this file does NOT prove
 *
 * It proves what this package IMPORTS. It cannot prove that nothing here
 * REIMPLEMENTS the maths: relative luminance is a dozen lines of arithmetic over
 * numbers already in hand, so a fourth implementation written inside
 * `packages/builder` would import nothing at all and every assertion below would
 * pass. `layering.test.ts` records the same limit about rendering, for the same
 * reason — an allowlist makes a shortcut inconvenient and cannot make it
 * impossible.
 *
 * So this is not the control for "no third colour parser". That rule is a
 * design constraint, enforced at review. What is enforced here is narrower and
 * genuinely checkable: the admin theme's implementation is not reachable from
 * the editor, by any route this package can take.
 */

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const UI_MANIFEST = join(SRC_DIR, "..", "..", "ui", "package.json");

/** Every module specifier this package imports, with the file that imports it. */
function everyImport(): { file: string; specifier: string }[] {
  const files = collectModules(
    SRC_DIR,
    at => readdirSync(at, { withFileTypes: true }),
    join
  );
  return files.flatMap(file =>
    importedSpecifiers(readFileSync(file, "utf8"), file).map(specifier => ({
      file,
      specifier,
    }))
  );
}

/** A specifier that climbs out of this package rather than staying inside it. */
function escapesPackage(specifier: string): boolean {
  return specifier.startsWith("../../");
}

describe("the admin theme's contrast implementation is out of reach", () => {
  it("is not published as a subpath, so no import can resolve to it", () => {
    // The strongest of the three checks, and the reason the others are cheap:
    // a subpath absent from `exports` cannot be imported however it is spelled.
    // Asserting it here means WIDENING that map becomes a deliberate act that
    // fails a test in the package it would affect.
    const manifest: unknown = JSON.parse(readFileSync(UI_MANIFEST, "utf8"));
    expect(manifest).toHaveProperty("exports");
    const exported = (manifest as { exports: Record<string, unknown> }).exports;
    // The positive control: a manifest read from the wrong path, or one whose
    // shape moved, would produce an empty object and every absence below would
    // hold vacuously.
    expect(Object.keys(exported).length).toBeGreaterThan(0);
    expect(Object.keys(exported)).toContain(".");
    for (const subpath of Object.keys(exported)) {
      expect(subpath).not.toContain("contrast");
    }
  });

  it("is not re-exported from the root barrel the editor does import", () => {
    // The route the export map leaves open: `@nextlyhq/ui` itself is allowed,
    // so anything its root re-exports is reachable.
    const barrel = readFileSync(
      join(SRC_DIR, "..", "..", "ui", "src", "index.ts"),
      "utf8"
    );
    expect(barrel.length).toBeGreaterThan(0);
    expect(barrel).not.toContain("styles/contrast");
  });

  it("is not reached by a relative path that climbs out of this package", () => {
    // `layering.test.ts` filters to BARE specifiers, because a relative path is
    // normally this package's own code. One that climbs past the package root
    // is not, and it bypasses the export map entirely — so it is the one route
    // an allowlist of package names cannot see.
    const escaping = everyImport().filter(({ specifier }) =>
      escapesPackage(specifier)
    );
    expect(escaping).toEqual([]);
  });

  it("finds the imports it is searching, so an empty result means something", () => {
    // An absence search needs a positive control. This package demonstrably
    // imports the engine; if the walk returned nothing, the assertion above
    // would pass over code it never read.
    const all = everyImport();
    expect(all.length).toBeGreaterThan(0);
    expect(
      all.some(({ specifier }) => specifier === "@nextlyhq/blocks-engine")
    ).toBe(true);
  });

  it("recognises a climbing specifier when it sees one", () => {
    // The negative control for `escapesPackage`: a predicate that answered
    // false for everything would make the sweep above pass on any codebase.
    expect(escapesPackage("../../ui/src/styles/contrast/color")).toBe(true);
    expect(escapesPackage("./style-controls")).toBe(false);
    expect(escapesPackage("../source-modules")).toBe(false);
  });
});
