/**
 * Every theme token the page-builder editor's stylesheets read without a
 * fallback must be emitted by the admin's built stylesheet, on the admin root.
 *
 * `packages/builder/src/styles/builder-chrome.css` and
 * `packages/plugin-page-builder/src/styles/editor.css` are not compiled
 * against the admin's Tailwind theme, so a `var(--text-xs)` in them makes
 * Tailwind emit nothing. They depend on the admin's sheet declaring each token
 * they read. Being declared in `theme.css` is not the same thing: a token in
 * an `@theme inline` block, or in a plain `@theme` that prunes unused tokens,
 * is emitted only when CSS that Tailwind compiles reads it. `--text-xs` was
 * declared there and absent from the build, so every editor label sized with
 * it fell back to the browser's 16px.
 *
 * Read from the real `dist/styles/globals.css` that this package's `build`
 * writes, which turbo runs before these tests. A `var()` with a fallback is
 * skipped, since it renders without the token. `--nx-*` tokens are plain
 * `:root` and `.dark` declarations the build always keeps, `--site-*` ones
 * belong to the site being edited, and a property either sheet declares
 * itself is local to it.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import postcss, {
  AtRule,
  type Container,
  type Document,
  type Root,
} from "postcss";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../../..");

const EDITOR_SHEETS = [
  "packages/builder/src/styles/builder-chrome.css",
  "packages/plugin-page-builder/src/styles/editor.css",
] as const;

const BUILT_SHEET = "packages/admin/dist/styles/globals.css";

/** The selector the admin's build rewrites the theme's `:root` to. */
const ADMIN_ROOT = ".nextly-admin";

/** Tokens owned elsewhere: the palette's, and the edited site's. */
const OUT_OF_SCOPE = /^--(?:nx|site)-/;

/**
 * Properties a component sets inline on the element that reads them, at
 * runtime, so no stylesheet declares them. Radix's Popover writes
 * `--radix-popover-trigger-width` on its content, sized to the trigger, and
 * its Accordion writes `--radix-accordion-content-height` on each panel
 * while it opens and closes, measured from the panel's content.
 * Named one by one: a prefix would also excuse a mistyped theme token.
 */
const SET_AT_RUNTIME = new Set([
  "--radix-popover-trigger-width",
  "--radix-accordion-content-height",
]);

/** A `var()` naming only a custom property, with no fallback after it. */
const READ_WITHOUT_FALLBACK = /var\(\s*(--[\w-]+)\s*\)/g;

function parseSheet(path: string): Root {
  const full = resolve(repo, path);
  if (!existsSync(full)) {
    throw new Error(
      `${path} does not exist; build @nextlyhq/admin (pnpm --filter @nextlyhq/admin... build) before this test`
    );
  }
  return postcss.parse(readFileSync(full, "utf8"), { from: full });
}

/**
 * The custom properties declared in a rule whose every selector is the admin
 * root, outside any at-rule but `@layer`. A declaration under a media query or
 * on a narrower selector does not reach every editor element, so it does not
 * count as emitted.
 */
function declaredOnAdminRoot(sheet: Root): Set<string> {
  const names = new Set<string>();
  sheet.walkRules(rule => {
    if (!rule.selectors.every(selector => selector.trim() === ADMIN_ROOT)) {
      return;
    }
    for (
      let parent: Container | Document | undefined = rule.parent;
      parent;
      parent = parent.parent
    ) {
      if (parent instanceof AtRule && parent.name !== "layer") return;
    }
    rule.each(child => {
      if (child.type === "decl" && child.prop.startsWith("--")) {
        names.add(child.prop);
      }
    });
  });
  return names;
}

/** Each sheet's fallback-less reads, and every property the sheets declare. */
function editorUsage(): {
  reads: Map<string, Set<string>>;
  local: Set<string>;
} {
  const reads = new Map<string, Set<string>>();
  const local = new Set<string>();
  for (const path of EDITOR_SHEETS) {
    parseSheet(path).walkDecls(decl => {
      if (decl.prop.startsWith("--")) local.add(decl.prop);
      for (const match of decl.value.matchAll(READ_WITHOUT_FALLBACK)) {
        const name = match[1]!;
        const files = reads.get(name) ?? new Set<string>();
        files.add(path.split("/").pop()!);
        reads.set(name, files);
      }
    });
  }
  return { reads, local };
}

describe("theme tokens the editor's stylesheets read", () => {
  const { reads, local } = editorUsage();
  const emitted = declaredOnAdminRoot(parseSheet(BUILT_SHEET));

  it("finds reads in the editor sheets, so the check below is not vacuous", () => {
    // Positive control: the scan sees the case this test exists for.
    expect([...reads.keys()]).toContain("--text-xs");
  });

  it("finds the admin root's declarations in the built sheet", () => {
    // Positive control: a palette token and the radius knob, both plain
    // `:root` declarations in `theme.css`, are always emitted.
    expect(emitted).toContain("--nx-background");
    expect(emitted).toContain("--radius");
  });

  it("are each declared on the admin root by the built stylesheet", () => {
    const missing = [...reads]
      .filter(
        ([name]) =>
          !OUT_OF_SCOPE.test(name) &&
          !SET_AT_RUNTIME.has(name) &&
          !local.has(name) &&
          !emitted.has(name)
      )
      .map(([name, files]) => `${name} (read by ${[...files].join(", ")})`)
      .sort();
    expect(missing).toEqual([]);
  });
});
