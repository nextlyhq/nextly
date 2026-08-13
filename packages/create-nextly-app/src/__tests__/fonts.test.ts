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
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

import fs from "fs-extra";
import { describe, expect, it } from "vitest";

import {
  collectFontDependencies,
  copyTemplate,
  generatePackageJson,
} from "../utils/template";
import type { DatabaseConfig } from "../types";

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
      // `.css` included, because the production collector treats CSS as import-bearing and a
      // template can name a path from `@import` or `url()`. A traversal narrower than the code it
      // guards reports clean over exactly the files it never opened.
    } else if (/\.(?:tsx?|jsx?|mjs|cjs|css)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const APP_TEMPLATES = ["base", "blank", "blog"] as const;

/**
 * Every source root the build-time-fetch bans apply to.
 *
 * The playground is not a template and is never scaffolded, but it IS built by CI, and its
 * `next/font/google` call is what reddened unrelated pull requests. A scan rooted only under
 * `templates/` stays green while half of this change is reverted.
 */
const SCANNED_ROOTS: readonly (readonly [string, string])[] = [
  ...APP_TEMPLATES.map(t => [t, path.join(TEMPLATES_ROOT, t)] as const),
  [
    "playground",
    path.resolve(TEMPLATES_ROOT, "..", "apps", "playground", "src"),
  ] as const,
];

/**
 * An IMPORT of the build-time font loader, not a mention of it.
 *
 * The layouts explain in prose why they no longer use `next/font/google`, and a
 * plain substring search flags that explanation — which would push the next
 * person to delete the comment that stops the fetch being reintroduced.
 */
/** A literal path into `node_modules`, which assumes a physical install layout. */
const NODE_MODULES_PATH = /["\x27][^"\x27]*node_modules\//;

const BUILD_TIME_FONT_IMPORT =
  /(?:from\s*|require\(\s*|import\(\s*)["']next\/font\/google["']/;

describe("no template fetches a font at build time", () => {
  it("finds the sources it is about to assert over", () => {
    // The positive control. `next/font/google` is asserted by ABSENCE below, and
    // absence is also what a wrong path, a renamed directory or a glob that
    // matches nothing produces — each of which would certify every template as
    // clean without reading a line.
    const files = SCANNED_ROOTS.flatMap(([, root]) => sourceFiles(root));
    // Asserted per ROOT as well as in aggregate: one root silently resolving to nothing would
    // otherwise hide behind the others' files, and its absence check would pass having read
    // nothing.
    for (const [, root] of SCANNED_ROOTS) {
      expect(sourceFiles(root).length).toBeGreaterThan(0);
    }
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

  it("recognises a node_modules path when it sees one", () => {
    // Positive control for the assertion below, which is satisfied by ABSENCE.
    expect(
      NODE_MODULES_PATH.test('src: "../../node_modules/@fontsource/x.woff2"')
    ).toBe(true);
    expect(NODE_MODULES_PATH.test('import "@fontsource-variable/inter";')).toBe(
      false
    );
  });

  it.each(SCANNED_ROOTS)("%s names no node_modules path", (_name, root) => {
    // A literal path asserts where a package physically lives. That is false under Yarn PnP
    // (no node_modules at all), under npm/Yarn workspace hoisting (the package moves to the
    // workspace root), and under pnpm's symlinked store — and the failure is a build error in
    // the user's project, not here.
    const offenders = sourceFiles(root).filter(file =>
      NODE_MODULES_PATH.test(fs.readFileSync(file, "utf8"))
    );

    expect(offenders.map(f => path.relative(root, f))).toEqual([]);
  });

  it.each(SCANNED_ROOTS)(
    "%s imports no build-time font fetch",
    (_name, root) => {
      const offenders = sourceFiles(root).filter(file =>
        BUILD_TIME_FONT_IMPORT.test(fs.readFileSync(file, "utf8"))
      );

      expect(offenders.map(f => path.relative(root, f))).toEqual([]);
    }
  );
});

describe("every template feeds the admin theme", () => {
  /** The `:root` block a template's `globals.css` declares, where the theme resolves. */
  function rootBlock(template: string): string {
    const css = fs.readFileSync(
      path.join(TEMPLATES_ROOT, template, "src/app/globals.css"),
      "utf8"
    );
    const start = css.indexOf(":root {");
    expect(start).toBeGreaterThanOrEqual(0);
    // Comments stripped first. The comments here QUOTE the theme's declarations by name, so a
    // scan over raw text matches the prose explaining a rule and reports the rule itself —
    // which is what pushes the next reader to delete the explanation to get a green.
    return css
      .slice(start, css.indexOf("}", start))
      .replace(/\/\*[\s\S]*?\*\//g, "");
  }

  it("reads declarations rather than the comments about them", () => {
    // Positive control for the stripping above: the shadow assertions are satisfied by ABSENCE,
    // and prose naming a token looks identical to a declaration of it.
    const blank = rootBlock("blank");
    expect(blank).toMatch(/--font-geist\s*:/);
    expect(blank).not.toContain("theme's OWN token");
  });

  it.each(APP_TEMPLATES)(
    "%s exposes the variables the admin reads",
    template => {
      // `packages/ui/src/styles/theme.css` declares
      // `--font-sans: var(--font-geist, Geist), ...` and
      // `--font-mono: var(--font-geist-mono, "Geist Mono"), ...` in a NON-INLINE `@theme`, so they
      // are emitted into `:root` and substitute there. A template that loads a different face still
      // has to publish it under these names, or its admin panel renders in a system fallback while
      // its own pages render correctly — which is easy to miss, because only /admin looks wrong.
      const root = rootBlock(template);
      expect(root).toMatch(/--font-geist\s*:/);
      expect(root).toMatch(/--font-geist-mono\s*:/);
    }
  );

  it.each(APP_TEMPLATES)(
    "%s does not shadow the theme's own tokens",
    template => {
      // `--font-sans` and `--font-mono` are the THEME's tokens, declared at `:root`. A template
      // redefining one at the same scope replaces the theme's whole fallback chain with a single
      // family rather than feeding it — a broken stack rather than a missing font.
      const root = rootBlock(template);
      expect(root).not.toMatch(/--font-sans\s*:/);
      expect(root).not.toMatch(/--font-mono\s*:/);
    }
  );
});

describe("a template's own utilities reach the face it loads", () => {
  it.each(APP_TEMPLATES)("%s binds font-mono if its pages use it", template => {
    const dir = path.join(TEMPLATES_ROOT, template);
    const usesMonoUtility = sourceFiles(dir).some(
      file =>
        file.endsWith(".tsx") &&
        /\bfont-mono\b/.test(fs.readFileSync(file, "utf8"))
    );
    if (!usesMonoUtility) return;

    // Frontend routes do not load the admin stylesheet, so nothing else binds this utility. It
    // has to be bound in an `@theme inline` block: a plain `@theme` emits the variable into
    // `:root`, where the admin declares its own, and would replace that fallback chain instead of
    // feeding it.
    const css = fs.readFileSync(path.join(dir, "src/app/globals.css"), "utf8");
    const inlineBlocks = [
      ...css.matchAll(/@theme\s+inline\s*\{([^}]*)\}/g),
    ].map(m => m[1] ?? "");
    expect(inlineBlocks.some(block => /--font-mono\s*:/.test(block))).toBe(
      true
    );
  });
});

describe("the scaffold installs the fonts its templates import", () => {
  /** The faces each scaffold's FINAL layout references, after the type overlays base. */
  const EXPECTED: Record<(typeof APP_TEMPLATES)[number], string[]> = {
    base: ["@fontsource-variable/geist", "@fontsource-variable/geist-mono"],
    blank: [
      "@fontsource-variable/inter",
      "@fontsource-variable/jetbrains-mono",
    ],
    blog: ["@fontsource-variable/geist-mono", "@fontsource-variable/inter"],
  };

  it.each(APP_TEMPLATES)(
    "%s emits a manifest carrying exactly the faces it renders",
    async template => {
      // Asserted against the GENERATED manifest, not against another scan of the same sources.
      // Comparing the collector with a second reader agrees with itself however the scaffold is
      // wired: deleting the dependency loop, or passing the caller no directories, left that
      // version green while every generated app was missing its fonts and failed to build.
      const manifest = JSON.parse(
        await generatePackageJson(
          "font-fixture",
          { type: "sqlite" } as DatabaseConfig,
          true,
          template,
          [
            path.join(TEMPLATES_ROOT, "base"),
            path.join(TEMPLATES_ROOT, template),
          ]
        )
      ) as { dependencies: Record<string, string> };

      const declared = Object.keys(manifest.dependencies)
        .filter(name => name.startsWith("@fontsource"))
        .sort();

      // Exact, not a superset. The overlay REPLACES base's layout, so a union would install the
      // faces of a layout this scaffold never receives.
      expect(declared).toEqual([...EXPECTED[template]].sort());
    }
  );

  it.each(APP_TEMPLATES)(
    "%s scaffolds a project whose manifest carries its fonts",
    async template => {
      // Through `copyTemplate`, which is where the directories are chosen. The manifest test
      // above passes them explicitly, so it cannot see the CALL SITE regress — measured: reverting
      // that argument to `[]` left every other case in this file green.
      const targetDir = await fs.mkdtemp(
        path.join(os.tmpdir(), `nextly-fonts-${template}-`)
      );
      try {
        await copyTemplate({
          projectName: "font-fixture",
          projectType: template,
          targetDir,
          database: { type: "sqlite" } as DatabaseConfig,
          useYalc: true,
          allowExistingTarget: true,
          templateSource: {
            basePath: path.join(TEMPLATES_ROOT, "base"),
            templatePath: path.join(TEMPLATES_ROOT, template),
          },
        });

        const manifest = JSON.parse(
          await fs.readFile(path.join(targetDir, "package.json"), "utf8")
        ) as { dependencies: Record<string, string> };

        expect(
          Object.keys(manifest.dependencies)
            .filter(name => name.startsWith("@fontsource"))
            .sort()
        ).toEqual([...EXPECTED[template]].sort());
      } finally {
        await fs.remove(targetDir);
      }
    }
  );

  it("declares nothing when the caller passes no template directories", () => {
    // The collector is handed the dirs the scaffold is COPYING. A downloaded or
    // --local-template source is a different tree from the bundled one, and a collector that
    // resolved its own path would install the fonts of templates the project never receives.
    expect(collectFontDependencies([])).resolves.toEqual([]);
  });

  it.each(APP_TEMPLATES)(
    "%s collector output matches what its merged sources import",
    async template => {
      const dirs = [
        path.join(TEMPLATES_ROOT, "base"),
        path.join(TEMPLATES_ROOT, template),
      ];
      // The overlay wins per relative path, mirroring the copy.
      const effective = new Map<string, string>();
      for (const dir of dirs) {
        for (const file of sourceFiles(dir)) {
          effective.set(path.relative(dir, file), file);
        }
      }
      const imported = new Set<string>();
      for (const file of effective.values()) {
        for (const match of fs
          .readFileSync(file, "utf8")
          .matchAll(/@fontsource(?:-variable)?\/[a-z0-9-]+/g)) {
          imported.add(match[0]);
        }
      }

      expect(imported.size).toBeGreaterThan(0);
      expect((await collectFontDependencies(dirs)).sort()).toEqual(
        [...imported].sort()
      );
    }
  );
});
