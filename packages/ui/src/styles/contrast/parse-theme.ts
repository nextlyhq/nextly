/**
 * Extracts the semantic `--nx-*` design tokens from `theme.css` for both modes.
 *
 * A real CSS parser (postcss) is used rather than a regex: token values can span
 * multiple lines and carry trailing comments (`--nx-input`), and the file mixes
 * `:root` / `.dark` rules with an `@theme` at-rule and `@custom-variant`. postcss
 * walks the declarations reliably where a regex would be brittle.
 *
 * The parser takes CSS text, not a file path, so this module stays free of any
 * Node filesystem dependency and remains browser-safe; the caller reads the file.
 */
import postcss from "postcss";

/** Token name (including the leading `--`) to its raw CSS value. */
export type TokenMap = Map<string, string>;

export interface ThemeTokens {
  /** Effective tokens in light mode (`:root`). */
  light: TokenMap;
  /**
   * Effective tokens in dark mode: `:root` overlaid with the `.dark` overrides.
   * `.dark` only redeclares tokens that differ, so a token defined once in
   * `:root` (e.g. `--nx-focus-ring`) still applies in dark mode via the cascade.
   * Merging here models that, so dark assertions see the colors that render.
   */
  dark: TokenMap;
}

/**
 * Parse the `--nx-*` custom properties from the light (`:root`) and dark
 * (`.dark`) rules of the given CSS text. Whitespace inside a value is collapsed
 * so a multi-line `oklch(...)` reads as one string; trailing comments are
 * already separated by postcss and never reach the value.
 */
export function parseThemeTokens(css: string): ThemeTokens {
  const root = postcss.parse(css);
  const light: TokenMap = new Map();
  const darkOverrides: TokenMap = new Map();

  root.walkRules(rule => {
    const target =
      rule.selector === ":root"
        ? light
        : rule.selector === ".dark"
          ? darkOverrides
          : null;
    if (!target) return;
    rule.walkDecls(decl => {
      if (!decl.prop.startsWith("--nx-")) return;
      target.set(decl.prop, decl.value.replace(/\s+/g, " ").trim());
    });
  });

  // Dark inherits every :root token it does not itself override.
  const dark: TokenMap = new Map([...light, ...darkOverrides]);
  return { light, dark };
}

const VAR_REF = /^var\(\s*(--[a-z0-9-]+)\s*\)$/i;

/**
 * Resolve a token's value within one mode, following `var(--nx-*)` references
 * transitively (e.g. `--nx-ring: var(--nx-primary)`). Throws on a missing or
 * circular reference so a broken token surfaces as a clear error rather than a
 * silently skipped assertion.
 */
export function resolveToken(
  map: TokenMap,
  token: string,
  seen: Set<string> = new Set()
): string {
  const value = map.get(token);
  if (value === undefined) {
    throw new Error(`token not found: ${token}`);
  }
  const match = VAR_REF.exec(value);
  if (!match) return value;

  const ref = match[1];
  if (seen.has(token)) {
    throw new Error(`circular var() reference through ${token}`);
  }
  seen.add(token);
  return resolveToken(map, ref, seen);
}
