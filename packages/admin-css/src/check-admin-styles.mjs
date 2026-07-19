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
// A literal color value: hex, or a color function that is NOT `var(...)`.
const LITERAL_COLOR = String.raw`#[0-9a-fA-F]{3,8}\b|(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\(`;
const HARDCODED_COLOR = new RegExp(
  String.raw`(?:^|[;{]|\s)(?:${COLOR_PROPS})\s*:\s*(?:${LITERAL_COLOR})`,
  "i"
);

/**
 * @param {{ css: string }} input
 * @returns {{ severity: "error" | "warning", message: string }[]}
 */
export function checkAdminStyles(input) {
  const issues = [];
  for (const rule of findUnscopedRules(input.css)) {
    issues.push({
      severity: "error",
      message: `admin.styles rule is not scoped under .nextly-admin: ${rule}`,
    });
  }
  if (HARDCODED_COLOR.test(input.css)) {
    issues.push({
      severity: "error",
      message:
        "admin.styles sets a hardcoded color on a color property; use a --nx-* token via var() so it themes in light and dark.",
    });
  }
  return issues;
}
