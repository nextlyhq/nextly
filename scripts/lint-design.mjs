#!/usr/bin/env node
/**
 * Design-system lint guard.
 *
 * Enforces the theming contract documented in
 * `packages/ui/docs/plugin-ui-authoring.md` across the admin and the plugin packages:
 *
 *   1. No token wrapped in a color function — `hsl(var(--x))` / `rgb(var(--x))`. Tokens are
 *      full OKLCH colors now, so wrapping them yields invalid CSS that the browser drops.
 *      Reference tokens directly: `var(--x)`. (Zero tolerance, every file.)
 *
 *   2. No hardcoded color literals (hex, or `rgb()/rgba()/hsl()/hsla()` with literal
 *      channels) in CSS files or plugin source. Colors must come from `var(--token)` /
 *      `color-mix(...)`. Exempt: mode-invariant black/white/transparent (shadows, scrims,
 *      canvas paper), `url(...)` data URIs, `placeholder` example values, the page-theme
 *      output defaults in `style-compiler.ts`, and any line marked `design-lint-ok`.
 *
 *   3. No stray `!important` in plugin packages. The admin keeps a small reviewed baseline
 *      (each one documented in place); the guard fails only if that count grows.
 *
 *   4. No Tailwind palette utilities — `text-green-600`, `bg-amber-50/30`, `dark:border-rose-200`.
 *      A hue is not a meaning: two of them stood in for "success" and two for "destructive",
 *      which is how they drift apart. Use the semantic scales instead — `success-*`,
 *      `warning-*`, `destructive-*`, `primary-*` — each derived from one token, so a
 *      retheme moves the whole scale. Neutrals come from `foreground` / `muted-foreground`
 *      / `border` / `border-strong`. Rules 1 and 2 cannot see these: a utility class is not
 *      a color literal, and it lives in `.tsx`, which rule 2 only reads inside plugins.
 *
 * A genuine exception gets an inline `design-lint-ok: <reason>` comment rather than
 * silencing the whole check. Run with `pnpm lint:design`.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";

import {
  createColorLiteralPattern,
  createPaletteClassPattern,
  createTokenWrapPattern,
  paletteAdvice,
  stripExemptColorPieces,
} from "@nextlyhq/eslint-plugin/vocabulary";

/**
 * The scanned trees, DISCOVERED rather than listed.
 *
 * A hardcoded list is complete only against the repository it was written for.
 * Every plugin package added afterwards is outside it, and the guard then
 * reports clean on that package in exactly the same words it uses for one it
 * examined — so the coverage silently stops growing with the repo.
 *
 * `templates/plugin` is here because the exemplar every plugin author copies is
 * held to the contract it teaches. The other templates are deliberately absent:
 * they are site starters, and a palette colour on someone's own marketing page
 * is their design decision rather than a theme violation.
 */
function deriveRoots() {
  const roots = [];
  const add = path => {
    if (existsSync(path)) roots.push(path);
  };

  add("packages/admin/src");
  // The shared token source is covered too, so token-consistency bugs (e.g. a
  // shadow that hardcodes a color instead of deriving from its token) can't ship
  // in the file every consumer depends on.
  add("packages/ui/src");
  for (const entry of readdirSync("packages", { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith("plugin-")) {
      add(`packages/${entry.name}/src`);
    }
  }
  add("templates/plugin/src");

  return roots;
}

// Files whose color literals are page-theme output defaults, not admin UI theming.
const FILE_ALLOWLIST = ["plugin-page-builder/src/core/style-compiler.ts"];

/**
 * Whether a file is a plugin surface, which decides the stricter rules.
 *
 * Matched on the path SHAPE rather than on a `"packages/plugin-"` substring.
 * The substring answers "no" for `templates/plugin/src/admin/SettingsPage.tsx`
 * — the one file the plugin rules most need to reach, since it is what every
 * third-party plugin is copied from — and it answers no silently, leaving the
 * exemplar exempt from the contract it demonstrates.
 */
const PLUGIN_SURFACE_RE =
  /(?:^|\/)(?:packages\/plugin-[^/]+|templates\/plugin)\//;

// Admin's reviewed `!important` baseline (see packages/admin/src/styles/globals.css). The
// guard fails if this grows; lower it when overrides are removed.
const ADMIN_IMPORTANT_BASELINE = 35;

const TOKEN_WRAP_RE = createTokenWrapPattern();
const COLOR_LITERAL_RE = createColorLiteralPattern();
const PALETTE_CLASS_RE = createPaletteClassPattern();

/** True for a line that is nothing but a comment — `//`, `/* … *​/`, or a JSDoc `*`. */
function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

const listFiles = roots =>
  execSync(
    `find ${roots.join(" ")} -type f \\( -name "*.css" -o -name "*.tsx" -o -name "*.ts" \\)`,
    { encoding: "utf8" }
  )
    .trim()
    .split("\n")
    .filter((f) => f && !/\.test\.|\.d\.ts$|__tests__/.test(f));

/** A color-literal line is exempt when nothing but mode-invariant black/white/transparent
 *  (or an allowed construct) remains after stripping the permitted pieces. */
function colorLiteralIsExempt(line, file) {
  if (line.includes("design-lint-ok")) return true;
  if (FILE_ALLOWLIST.some((f) => file.endsWith(f))) return true;
  // The Tailwind palette scale (`--color-blue-500: #3b82f6`) is the literal
  // source of truth in theme.css; only these `--color-*` scale definitions are
  // allowed to hardcode. Semantic tokens and shadows must still derive from them.
  if (/--color-[a-z]+-\d+\s*:/.test(line)) return true;
  // The mode-invariant strip is shared with the published ESLint rules, so the
  // two guards cannot disagree about which literals are legitimate.
  return !COLOR_LITERAL_RE.test(stripExemptColorPieces(line));
}

const roots = deriveRoots();
const files = listFiles(roots);

const violations = [];
let adminImportant = 0;
let pluginClassified = 0;

for (const file of files) {
  const isCss = file.endsWith(".css");
  const isPlugin = PLUGIN_SURFACE_RE.test(file);
  if (isPlugin) pluginClassified += 1;
  // The theme declares the palette scales themselves; it is the one place the
  // hue names are the subject rather than a shortcut past the tokens.
  const isThemeSource = file.endsWith("ui/src/styles/theme.css");
  const lines = readFileSync(file, "utf8").split("\n");

  lines.forEach((line, i) => {
    const at = `${file}:${i + 1}`;

    // 1. token wrapped in a color function — everywhere.
    if (TOKEN_WRAP_RE.test(line)) {
      violations.push(`${at}  token wrapped in color fn — use var(--token): ${line.trim()}`);
    }

    // 2. hardcoded color literal — CSS files (any package) or plugin source.
    if ((isCss || isPlugin) && COLOR_LITERAL_RE.test(line) && !colorLiteralIsExempt(line, file)) {
      violations.push(`${at}  hardcoded color — use var(--token)/color-mix: ${line.trim()}`);
    }

    // 3. !important — banned in plugins; baseline-capped in admin.
    if (line.includes("!important")) {
      if (isPlugin) {
        violations.push(`${at}  !important not allowed in plugins: ${line.trim()}`);
      } else {
        adminImportant += 1;
      }
    }

    // 4. Tailwind palette utility — every package, every file type. The theme
    //    defines its own `--color-{hue}-*` scales, so skip the file that owns them.
    //    A comment naming a hue is prose (a JSDoc example, a note about what a
    //    line used to be) and styles nothing, so whole-comment lines are skipped.
    if (!isThemeSource && !isCommentLine(line)) {
      const paletteMatch = PALETTE_CLASS_RE.exec(line);
      if (paletteMatch && !line.includes("design-lint-ok")) {
        violations.push(
          `${at}  palette class \`${paletteMatch[1]}\` — ${paletteAdvice(paletteMatch[1])}: ${line.trim()}`
        );
      }
    }
  });
}

/**
 * What the run actually read, asserted before any verdict is reported.
 *
 * A scan whose roots resolved to nothing finds no violations and exits 0, which
 * is byte-identical to a clean repository. The three populations are reported
 * separately because they fail independently: roots can resolve while matching
 * no files, and files can be read while none of them is classified as a plugin
 * surface — and that last case makes every plugin-only rule inert while the
 * summary still reads as a pass.
 */
const populations = [
  ["roots", roots.length],
  ["files", files.length],
  ["plugin-surface files", pluginClassified],
];
const empty = populations.filter(([, count]) => count === 0);
if (empty.length > 0) {
  console.error(
    `\n✖ Design lint could not run: ${empty
      .map(([label]) => `no ${label}`)
      .join(", ")}.\n\n` +
      "  This is not a pass. The guard reports nothing when it reads nothing,\n" +
      "  so an empty population is a tooling failure rather than a clean tree.\n"
  );
  process.exit(1);
}

if (adminImportant > ADMIN_IMPORTANT_BASELINE) {
  violations.push(
    `admin: ${adminImportant} \`!important\` exceed the reviewed baseline of ${ADMIN_IMPORTANT_BASELINE}. ` +
      `Remove the new one(s) or, if justified, document it and raise the baseline in scripts/lint-design.mjs.`
  );
}

if (violations.length) {
  console.error(`\n✖ Design lint failed (${violations.length}):\n`);
  for (const v of violations) console.error("  " + v);
  console.error(
    "\nSee packages/ui/docs/plugin-ui-authoring.md. Mark a genuine exception with a `design-lint-ok: <reason>` comment.\n"
  );
  process.exit(1);
}

console.log(
  `✓ Design lint passed — ${files.length} files across ${roots.length} roots ` +
    `(${pluginClassified} plugin-surface), admin \`!important\`: ` +
    `${adminImportant}/${ADMIN_IMPORTANT_BASELINE}.`
);
console.log(`  roots: ${roots.join(", ")}`);
