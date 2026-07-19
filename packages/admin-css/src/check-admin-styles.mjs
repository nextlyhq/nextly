/**
 * Validate a plugin's compiled admin CSS against the two invariants the admin
 * styling model depends on: every rule is scoped under `.nextly-admin` (so it
 * cannot restyle the host page), and colors come from `--nx-*` tokens (so the
 * UI themes in light and dark) rather than being hardcoded.
 *
 * Runs on the SCOPED, compiled output (the same string the plugin ships), so it
 * is the last gate before an `admin.styles` file is written. Token DEFINITIONS
 * (`--nx-foo: oklch(...)`) are custom properties, not standard color
 * declarations, so they are intentionally not flagged — only a literal color on
 * a real color property (bypassing the tokens) is.
 */
import { findUnscopedRules } from "./css-scope.mjs";

// Standard properties whose value should be a token, never a literal color.
const COLOR_PROPS =
  "color|background|background-color|border-color|outline-color|fill|stroke|caret-color|text-decoration-color";
// The common named CSS colors. CSS-wide keywords (transparent, currentColor,
// inherit, initial, unset, none) are deliberately excluded — they carry no
// theme and are legitimate.
const NAMED_COLORS =
  "red|orange|yellow|green|blue|indigo|violet|purple|pink|brown|black|white|gray|grey|cyan|magenta|gold|silver|maroon|navy|teal|olive|lime|aqua|fuchsia";
// A literal color value: hex, a color function that is NOT `var(...)`, or a
// named color. The named-color branch uses `(?<![\w-])…(?![\w-])` so it matches
// a standalone value (`color: white`) but never a color word inside an
// identifier such as a token name (`var(--nx-white)`).
const LITERAL_COLOR =
  String.raw`#[0-9a-fA-F]{3,8}\b` +
  String.raw`|(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\(` +
  String.raw`|(?<![\w-])(?:${NAMED_COLORS})(?![\w-])`;
// Match a literal color ANYWHERE in the property's value (up to the next `;` or
// `}`), not just immediately after the colon, so a literal hidden in a `var()`
// fallback — e.g. `color: var(--nx-x, #ff0000)` — is still caught.
const HARDCODED_COLOR = new RegExp(
  String.raw`(?:^|[;{]|\s)(?:${COLOR_PROPS})\s*:[^;}]*(?:${LITERAL_COLOR})`,
  "i"
);

// Strip CSS comments so a literal color inside `/* ... */` is not mistaken for a
// real declaration (mirrors findUnscopedRules, which strips them internally).
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * @param {{ css: string }} input
 * @returns {{ severity: "error" | "warning", message: string }[]}
 */
export function checkAdminStyles(input) {
  const issues = [];
  const css = stripComments(input.css);
  for (const rule of findUnscopedRules(css)) {
    issues.push({
      severity: "error",
      message: `admin.styles rule is not scoped under .nextly-admin: ${rule}`,
    });
  }
  if (HARDCODED_COLOR.test(css)) {
    issues.push({
      severity: "error",
      message:
        "admin.styles sets a hardcoded color on a color property; use a --nx-* token via var() so it themes in light and dark.",
    });
  }
  return issues;
}
