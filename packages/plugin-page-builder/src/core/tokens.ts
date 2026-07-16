/**
 * Global design tokens (spec §8/G). React-free. The compiler already emits the palette
 * as CSS custom properties (`compileTokensCss`) and `PageRenderer` accepts a `tokens`
 * override, so changing the palette in ONE place restyles every block that references a
 * token. This module exposes the palette as inspector swatches so authors can pick token
 * refs (stored as `{ token }`) instead of raw colors.
 */
import { DEFAULT_TOKENS } from "./style-compiler";

export interface TokenSwatch {
  name: string;
  label: string;
  preview: string;
}

function humanize(key: string): string {
  const base = key.replace(/^color\./, "");
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/** Build inspector swatches from a token record (defaults to the built-in palette). */
export function tokenSwatches(
  tokens: Record<string, string> = DEFAULT_TOKENS
): TokenSwatch[] {
  return Object.entries(tokens).map(([name, preview]) => ({
    name,
    preview,
    label: humanize(name),
  }));
}
