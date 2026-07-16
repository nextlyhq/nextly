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
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const ROOTS = [
  "packages/admin/src",
  "packages/plugin-form-builder/src",
  "packages/plugin-page-builder/src",
  // The shared token source is covered too, so token-consistency bugs (e.g. a
  // shadow that hardcodes a color instead of deriving from its token) can't ship
  // in the file every consumer depends on.
  "packages/ui/src",
];

// Files whose color literals are page-theme output defaults, not admin UI theming.
const FILE_ALLOWLIST = ["plugin-page-builder/src/core/style-compiler.ts"];

const PLUGIN_MARKER = "packages/plugin-";
// Admin's reviewed `!important` baseline (see packages/admin/src/styles/globals.css). The
// guard fails if this grows; lower it when overrides are removed.
const ADMIN_IMPORTANT_BASELINE = 35;

const TOKEN_WRAP_RE = /\b(?:hsl|hsla|rgb|rgba)\(\s*var\(/;
const COLOR_LITERAL_RE = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(\s*[0-9.]/;

// Tailwind's built-in palette, which ships with the framework whether or not
// theme.css redefines a given hue — so `bg-emerald-50` compiles even though no
// `--color-emerald-*` is declared anywhere here. That is exactly why this needs
// its own rule.
const PALETTE_HUES =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const COLOR_UTILS =
  "text|bg|border|ring|ring-offset|from|via|to|fill|stroke|shadow|outline|decoration|accent|caret|divide|placeholder";
// Longest shade first: `50|\d{3}` would match `500` as `50` and let it through.
const PALETTE_SHADES = "950|900|800|700|600|500|400|300|200|100|50";
// Anchored on a class-list boundary so `translate-x-1/2` (which contains
// "slate-x") and a prose mention of a colour are not read as utilities.
const PALETTE_CLASS_RE = new RegExp(
  `(?:^|[\\s"'\`{])((?:[a-z-]+:)*!?(?:${COLOR_UTILS})-(?:${PALETTE_HUES})-(?:${PALETTE_SHADES})(?:\\/\\d{1,3})?)(?![\\w-])`
);

/** The token scale that replaced each hue, so the error says what to do next. */
const HUE_REPLACEMENT = {
  green: "success-*",
  emerald: "success-*",
  red: "destructive-*",
  rose: "destructive-*",
  amber: "warning-*",
  yellow: "warning-*",
  orange: "warning-*",
};

/** True for a line that is nothing but a comment — `//`, `/* … *​/`, or a JSDoc `*`. */
function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

function paletteAdvice(match) {
  const hue = new RegExp(`(${PALETTE_HUES})`).exec(match)?.[1];
  const replacement = hue && HUE_REPLACEMENT[hue];
  if (replacement) return `use ${replacement}`;
  return "use a semantic scale (success-*/warning-*/destructive-*/primary-*) or a neutral token";
}

const listFiles = () =>
  execSync(
    `find ${ROOTS.join(" ")} -type f \\( -name "*.css" -o -name "*.tsx" -o -name "*.ts" \\)`,
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
  let rest = line
    // strip inline comments (a hex inside `/* … */` is documentation, not code)
    .replace(/\/\*.*?\*\//g, "")
    .replace(/url\([^)]*\)/g, "")
    .replace(/placeholder\s*[:=]\s*["'][^"']*["']/g, "")
    // black / white, with an optional 2-digit alpha (`#00000033` shadow scrims)
    .replace(/#(?:ffffff|fff|000000|000)(?:[0-9a-f]{2})?\b/gi, "")
    .replace(/rgba?\(\s*0\s*[,\s]\s*0\s*[,\s]\s*0[^)]*\)/gi, "")
    .replace(/rgba?\(\s*255\s*[,\s]\s*255\s*[,\s]\s*255[^)]*\)/gi, "");
  return !COLOR_LITERAL_RE.test(rest);
}

const violations = [];
let adminImportant = 0;

for (const file of listFiles()) {
  const isCss = file.endsWith(".css");
  const isPlugin = file.includes(PLUGIN_MARKER);
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
  `✓ Design lint passed (admin \`!important\`: ${adminImportant}/${ADMIN_IMPORTANT_BASELINE}).`
);
