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

/**
 * Chart slots wired to the roles the theme already declares.
 *
 * The dashboard reads `--nx-chart-*`, and a theme that emits only the tokens
 * in its own maps leaves those at the SHIPPED palette: the page and the cards
 * take the selected theme while the charts stay amber-and-cyan, so a dashboard
 * capture shows two palettes at once and reads as one. `--nx-chart-1` was
 * never affected because the shipped rule already points it at
 * `var(--nx-primary)`, which a theme does override -- that is the shape copied
 * here for the rest.
 *
 * Derived rather than authored per theme: a chart colour is not a free choice,
 * it is "the theme's success green", and asking nine themes to restate values
 * they already declare is how the two drift apart.
 *
 * CHART_2 is deliberately absent. The shipped palette puts a cyan there and no
 * theme role is cyan, so deriving it would invent a colour nobody chose. It
 * keeps the shipped value, and the test beside this pins that the omission is
 * this one slot rather than an oversight that grew.
 */
const CHART_ROLES: ReadonlyArray<readonly [slot: number, role: string]> = [
  [1, "primary"],
  [3, "success"],
  [4, "warning"],
  [5, "destructive"],
];

export const CHART_SLOT_WITHOUT_A_ROLE = 2;

function chartDeclarations(): string {
  return CHART_ROLES.map(
    ([slot, role]) => `  --nx-chart-${slot}: var(--nx-${role});`
  ).join("\n");
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
    // Emitted in the light block only: each one points at a role token that
    // the dark block redeclares, so the indirection resolves per mode without
    // being written twice.
    chartDeclarations(),
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
