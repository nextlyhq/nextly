/**
 * Emits the scoped stylesheet for a set of themes.
 *
 * Selectors are attribute-scoped so a theme override outranks the base
 * `.nextly-admin` declarations by specificity without needing `!important`,
 * and so nothing can leak into the host page around the admin.
 */
import type { ThemeDefinition, ThemeTokens } from "./types";
import { REQUIRED_TOKENS } from "./types";

function assertComplete(theme: ThemeDefinition, mode: "light" | "dark"): void {
  const tokens: ThemeTokens = theme[mode];
  for (const name of REQUIRED_TOKENS) {
    if (!tokens[name]) {
      throw new Error(
        `theme "${theme.id}" is missing the ${mode} token "${name}"`
      );
    }
  }
}

function declarations(tokens: ThemeTokens): string {
  return Object.entries(tokens)
    .map(([name, value]) => `  --nx-${name}: ${value};`)
    .join("\n");
}

export function themeToCss(theme: ThemeDefinition): string {
  assertComplete(theme, "light");
  assertComplete(theme, "dark");

  const shell = [
    `  --radius: ${theme.radius};`,
    `  --font-sans: ${theme.fontSans};`,
    `  --font-mono: ${theme.fontMono};`,
    theme.fontSerif ? `  --font-serif: ${theme.fontSerif};` : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  return [
    `.nextly-admin[data-theme="${theme.id}"] {`,
    shell,
    declarations(theme.light),
    `}`,
    ``,
    `.nextly-admin.dark[data-theme="${theme.id}"] {`,
    declarations(theme.dark),
    `}`,
    ``,
  ].join("\n");
}

export function themesToStylesheet(themes: ThemeDefinition[]): string {
  return themes.map(themeToCss).join("\n");
}
