import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
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
const PACKAGE_ROOT = join(SRC_DIR, "..");
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

/**
 * A relative specifier that resolves OUTSIDE this package.
 *
 * Resolved rather than pattern-matched. Counting `../` segments answers a
 * question about spelling, not about where the import lands: how many segments
 * leave the package depends on how deep the importing file sits, so the same
 * prefix escapes from `src/` and stays inside from `src/a/b/`. It also reports
 * `../../builder/src/x` — which comes straight back in — as an escape, and
 * misses a path whose `../` only appear after normalization.
 */
function escapesPackage(file: string, specifier: string): boolean {
  if (!specifier.startsWith(".")) return false;
  const target = resolve(dirname(file), specifier);
  return relative(PACKAGE_ROOT, target).startsWith("..");
}

/**
 * Every string an `exports` map can send an import to, however nested.
 *
 * The map's VALUES are what decide reachability; its keys are only what a
 * caller types. A check reading keys alone passes a map whose key says nothing
 * about contrast and whose target resolves straight into it.
 */
function exportTargets(node: unknown, found: string[] = []): string[] {
  if (typeof node === "string") found.push(node);
  else if (node !== null && typeof node === "object") {
    for (const value of Object.values(node)) exportTargets(value, found);
  }
  return found;
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
    const targets = exportTargets(exported);
    // Targets as well as keys. A subpath named `./styles` pointing at the
    // contrast build would pass a key-only check.
    expect(targets.length).toBeGreaterThan(0);
    for (const entry of [...Object.keys(exported), ...targets]) {
      expect(entry).not.toContain("contrast");
    }
    // A WILDCARD would make the map unbounded and this check blind: `./x/*`
    // admits every file under its target, and no string comparison here can
    // enumerate them. Failing on one is the honest answer — it says the guard
    // can no longer see what is reachable, rather than reporting clean.
    for (const entry of [...Object.keys(exported), ...targets]) {
      expect(entry).not.toContain("*");
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
    const escaping = everyImport().filter(({ file, specifier }) =>
      escapesPackage(file, specifier)
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

  it("recognises an escaping specifier from any depth, and only a real escape", () => {
    // The controls for `escapesPackage`. A predicate answering false for
    // everything would make the sweep above pass on any codebase; one answering
    // by prefix would disagree with itself as files move between directories.
    const shallow = join(SRC_DIR, "example.ts");
    const deep = join(SRC_DIR, "nested", "deeper", "example.ts");

    expect(escapesPackage(shallow, "../../ui/src/styles/contrast/color")).toBe(
      true
    );
    // Same spelling, deeper file: it lands inside this package, so it is not an
    // escape — which a prefix test cannot tell apart.
    expect(escapesPackage(deep, "../../ui/src/styles/contrast/color")).toBe(
      false
    );
    // A deeper file needs more segments to leave, and this one does.
    expect(
      escapesPackage(deep, "../../../../ui/src/styles/contrast/color")
    ).toBe(true);
    // Climbs out and comes straight back: not an escape, and a prefix test
    // reports it as one.
    expect(escapesPackage(shallow, "../../builder/src/style-controls")).toBe(
      false
    );
    expect(escapesPackage(shallow, "./style-controls")).toBe(false);
    expect(escapesPackage(shallow, "@nextlyhq/ui")).toBe(false);
  });
});
