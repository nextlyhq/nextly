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
import { execFileSync } from "node:child_process";

import {
  createColorLiteralPattern,
  createPaletteClassPattern,
  createTokenWrapPattern,
  hasExemptionDirective,
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
export function deriveRoots() {
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

/** Whether this path is a plugin surface, and so subject to the stricter rules. */
export function isPluginSurface(file) {
  return PLUGIN_SURFACE_RE.test(file);
}

// Admin's reviewed `!important` baseline (see packages/admin/src/styles/globals.css). The
// guard fails if this grows; lower it when overrides are removed.
const ADMIN_IMPORTANT_BASELINE = 35;

const TOKEN_WRAP_RE = createTokenWrapPattern();
const COLOR_LITERAL_RE = createColorLiteralPattern();
const PALETTE_CLASS_RE = createPaletteClassPattern();

/** True for a line that is nothing but a comment — `//`, `/* … *​/`, or a JSDoc `*`. */
export function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

const listFiles = roots =>
  // `execFileSync` with an argument array rather than a shell string: a root is
  // a path from the filesystem, and one containing a space or a shell
  // metacharacter would otherwise change the command instead of being one
  // argument to it.
  execFileSync(
    "find",
    [
      ...roots,
      "-type", "f",
      "(", "-name", "*.css", "-o", "-name", "*.tsx", "-o", "-name", "*.ts", ")",
    ],
    { encoding: "utf8" }
  )
    .trim()
    .split("\n")
    .filter((f) => f && !/\.test\.|\.d\.ts$|__tests__/.test(f));

/** A color-literal line is exempt when nothing but mode-invariant black/white/transparent
 *  (or an allowed construct) remains after stripping the permitted pieces. */
export function colorLiteralIsExempt(line, file) {
  if (hasExemptionDirective(line)) return true;
  if (FILE_ALLOWLIST.some((f) => file.endsWith(f))) return true;
  // The Tailwind palette scale (`--color-blue-500: #3b82f6`) is the literal
  // source of truth in theme.css; only these `--color-*` scale definitions are
  // allowed to hardcode. Semantic tokens and shadows must still derive from them.
  if (/--color-[a-z]+-\d+\s*:/.test(line)) return true;
  // A custom-property DECLARATION in the theme source is the definition every
  // other file refers to through `var()`, so it is the one place a colour is
  // written down rather than referenced. Scoped to that file: the same line
  // anywhere else is a second definition of a colour the tokens already carry.
  if (
    file.endsWith("ui/src/styles/theme.css") &&
    /^\s*--[\w-]+\s*:/.test(line)
  ) {
    return true;
  }
  // The mode-invariant strip is shared with the published ESLint rules, so the
  // two guards cannot disagree about which literals are legitimate.
  return !COLOR_LITERAL_RE.test(stripExemptColorPieces(line));
}

/**
 * Refuse, rather than report, when the run read nothing.
 *
 * Separate from the violation list because the two are different outcomes: no
 * violations is a verdict, and nothing scanned is the absence of one. Reporting
 * the second as the first is the failure this guard is meant not to have.
 */
function refuse(missing) {
  console.error(
    `\n✖ Design lint could not run: ${missing.join(", ")}.\n\n` +
      "  This is not a pass. The guard reports nothing when it reads nothing,\n" +
      "  so an empty population is a tooling failure rather than a clean tree.\n"
  );
  process.exit(1);
}

/**
 * The four rules, each as its own decision so the reason a line is reported is
 * separable from the loop that visits lines. Each returns the violation text,
 * or `null` when the line is clean under that rule.
 */
export function tokenWrapViolation(at, line) {
  if (!TOKEN_WRAP_RE.test(line)) return null;
  return `${at}  token wrapped in color fn — use var(--token): ${line.trim()}`;
}

export function colorLiteralViolation(at, line, file, { isCss, isPlugin }) {
  if (!isCss && !isPlugin) return null;
  if (!COLOR_LITERAL_RE.test(line)) return null;
  if (colorLiteralIsExempt(line, file)) return null;
  return `${at}  hardcoded color — use var(--token)/color-mix: ${line.trim()}`;
}

export function paletteViolation(at, line, { isThemeSource }) {
  if (isThemeSource || isCommentLine(line)) return null;
  const match = PALETTE_CLASS_RE.exec(line);
  if (!match || hasExemptionDirective(line)) return null;
  return `${at}  palette class \`${match[1]}\` — ${paletteAdvice(match[1])}: ${line.trim()}`;
}

/**
 * Audit one file's source.
 *
 * Takes the SOURCE rather than reading it, so the rules can be exercised
 * without a fixture on disk — the reason this was previously untestable was
 * that the only way to reach it was to run the whole scan.
 *
 * `!important` is counted rather than reported outside a plugin, because the
 * admin carries a reviewed baseline that this returns for the caller to ratchet.
 */
export function auditFile(file, source) {
  const isCss = file.endsWith(".css");
  const isPlugin = isPluginSurface(file);
  // The theme declares the palette scales themselves; it is the one place the
  // hue names are the subject rather than a shortcut past the tokens.
  const isThemeSource = file.endsWith("ui/src/styles/theme.css");

  const violations = [];
  let adminImportant = 0;

  source.split("\n").forEach((line, index) => {
    const at = `${file}:${index + 1}`;

    for (const found of [
      tokenWrapViolation(at, line),
      colorLiteralViolation(at, line, file, { isCss, isPlugin }),
      paletteViolation(at, line, { isThemeSource }),
    ]) {
      if (found) violations.push(found);
    }

    if (line.includes("!important")) {
      if (isPlugin) {
        violations.push(`${at}  !important not allowed in plugins: ${line.trim()}`);
      } else {
        adminImportant += 1;
      }
    }
  });

  return { violations, adminImportant, isPlugin };
}

/**
 * The populations whose emptiness means the run could not look, rather than
 * that it looked and found nothing. Returned rather than printed so the caller
 * decides, and so a test can ask without catching `process.exit`.
 */
export function emptyPopulations({ files, pluginClassified }) {
  return [
    ["files", files],
    ["plugin-surface files", pluginClassified],
  ]
    .filter(([, count]) => count === 0)
    .map(([label]) => `no ${label}`);
}

function main() {
  const roots = deriveRoots();
  // Checked before `listFiles`, which shells out to `find`: with no paths that
  // command fails and takes the process down before any population is reported,
  // so the refusal below would be unreachable and the operator would see a
  // stack trace instead of the reason.
  if (roots.length === 0) refuse(["no roots"]);

  const files = listFiles(roots);

  const violations = [];
  let adminImportant = 0;
  let pluginClassified = 0;

  for (const file of files) {
    const result = auditFile(file, readFileSync(file, "utf8"));
    violations.push(...result.violations);
    adminImportant += result.adminImportant;
    if (result.isPlugin) pluginClassified += 1;
  }

  const empty = emptyPopulations({
    files: files.length,
    pluginClassified,
  });
  if (empty.length > 0) refuse(empty);

  report({ roots, files, violations, adminImportant, pluginClassified });
}

function report({ roots, files, violations, adminImportant, pluginClassified }) {
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
}

// Runs only when invoked directly, so importing this module for tests does not
// scan the repository or call `process.exit`. Matched on the script NAME rather
// than by comparing `import.meta.url` to `process.argv[1]`: that comparison is
// sensitive to how the path was resolved — a symlinked prefix breaks it, and
// resolving with `realpathSync` breaks the opposite case, because
// `--preserve-symlinks-main` is settable through `NODE_OPTIONS`.
if (process.argv[1] && process.argv[1].endsWith("lint-design.mjs")) {
  main();
}
