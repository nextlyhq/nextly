/**
 * Fonts must not be fetched at build time, and the scaffold must install the
 * ones its templates import.
 *
 * `next/font/google` downloads the face from fonts.googleapis.com while
 * `next build` runs. That makes a build depend on reaching a third party, so it
 * fails behind a proxy, on a locked-down runner, and offline — and it took the
 * browser suite with it, because its global setup builds first. Both properties
 * below exist to keep that from coming back.
 */
import path from "path";
import { fileURLToPath } from "url";

import fs from "fs-extra";
import { describe, expect, it } from "vitest";

import { collectFontDependencies } from "../utils/template";

const TEMPLATES_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../templates"
);

/** Every file a template ships that could carry an import specifier. */
function sourceFiles(root: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      out.push(...sourceFiles(full));
    } else if (/\.(?:tsx?|jsx?|mjs|cjs)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const APP_TEMPLATES = ["base", "blank", "blog"] as const;

/**
 * An IMPORT of the build-time font loader, not a mention of it.
 *
 * The layouts explain in prose why they no longer use `next/font/google`, and a
 * plain substring search flags that explanation — which would push the next
 * person to delete the comment that stops the fetch being reintroduced.
 */
const BUILD_TIME_FONT_IMPORT =
  /(?:from\s*|require\(\s*|import\(\s*)["']next\/font\/google["']/;

describe("no template fetches a font at build time", () => {
  it("finds the template sources it is about to assert over", () => {
    // The positive control. `next/font/google` is asserted by ABSENCE below, and
    // absence is also what a wrong path, a renamed directory or a glob that
    // matches nothing produces — each of which would certify every template as
    // clean without reading a line.
    const files = APP_TEMPLATES.flatMap(t =>
      sourceFiles(path.join(TEMPLATES_ROOT, t))
    );
    expect(files.length).toBeGreaterThan(0);
    expect(
      files.some(f => f.endsWith(path.join("src", "app", "layout.tsx")))
    ).toBe(true);
  });

  it("recognises a build-time font import when it sees one", () => {
    // The pattern is what every assertion below trusts, and it is asserted by
    // ABSENCE — so it is checked against a line it must match, and against the
    // prose in the layouts it must NOT.
    expect(
      BUILD_TIME_FONT_IMPORT.test('import { Inter } from "next/font/google";')
    ).toBe(true);
    expect(
      BUILD_TIME_FONT_IMPORT.test(
        " * `next/font/google`, which fetches them from fonts.googleapis.com"
      )
    ).toBe(false);
  });

  it.each(APP_TEMPLATES)("%s imports no build-time font fetch", template => {
    const offenders = sourceFiles(path.join(TEMPLATES_ROOT, template)).filter(
      file => BUILD_TIME_FONT_IMPORT.test(fs.readFileSync(file, "utf8"))
    );

    expect(offenders.map(f => path.relative(TEMPLATES_ROOT, f))).toEqual([]);
  });
});

describe("the scaffold installs the fonts its templates import", () => {
  it.each(APP_TEMPLATES)(
    "%s declares every font package its sources reference",
    async template => {
      const dirs = [
        path.join(TEMPLATES_ROOT, "base"),
        path.join(TEMPLATES_ROOT, template),
      ];

      // What the templates actually import, read independently of the
      // collector — a test that called the collector twice would agree with
      // itself no matter what either one did.
      const imported = new Set<string>();
      for (const dir of dirs) {
        for (const file of sourceFiles(dir)) {
          for (const match of fs
            .readFileSync(file, "utf8")
            .matchAll(/@fontsource(?:-variable)?\/[a-z0-9-]+/g)) {
            imported.add(match[0]);
          }
        }
      }

      // Every template loads at least one face, so an empty set here means the
      // read found nothing rather than that nothing is needed.
      expect(imported.size).toBeGreaterThan(0);
      expect((await collectFontDependencies(dirs)).sort()).toEqual(
        [...imported].sort()
      );
    }
  );

  it("reads the directories it is given rather than resolving its own", async () => {
    // The collector is handed the dirs the scaffold is COPYING. A downloaded or
    // --local-template source is a different tree from the bundled one, and a
    // collector that resolved its own path would install the fonts of templates
    // the project never receives.
    expect(await collectFontDependencies([])).toEqual([]);
    expect(
      await collectFontDependencies([path.join(TEMPLATES_ROOT, "base")])
    ).not.toEqual([]);
  });
});
