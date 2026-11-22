/**
 * The engine's built-in type sizes as site variables: `font-size.h1` to `h6`
 * and `font-size.small`, each with the `line-height.*` it pairs with.
 *
 * Its own file because it is one table and the tokens made from it, apart
 * from the token rules `site-tokens` holds.
 *
 * @module type-size-defaults
 */
import type { SiteToken } from "./site-tokens";

/**
 * The built-in type sizes, each a size and the line height it pairs with
 * (`font-size.h2` and `line-height.h2`). The heading sizes are the ones the
 * block library drew before Site text existed, at a 16px root, in `rem` so
 * they follow the reader's text size; the heading rows of Site text point
 * at them, and Small is there to be picked. Line height tightens as the size
 * grows, because large text needs less leading to stay readable.
 */
const TYPE_SIZE_DEFAULTS: readonly (readonly [string, string, string])[] = [
  ["h1", "2.25rem", "1.15"],
  ["h2", "1.75rem", "1.2"],
  ["h3", "1.375rem", "1.3"],
  ["h4", "1.125rem", "1.4"],
  ["h5", "1rem", "1.45"],
  ["h6", "0.875rem", "1.5"],
  ["small", "0.875rem", "1.5"],
];

/** Each built-in type size as its two variables: the size and its line height. */
export function typeSizeDefaultTokens(): SiteToken[] {
  return TYPE_SIZE_DEFAULTS.flatMap(([name, size, lineHeight]): SiteToken[] => [
    { name: `font-size.${name}`, kind: "dimension", values: { light: size } },
    {
      name: `line-height.${name}`,
      kind: "number",
      values: { light: lineHeight },
    },
  ]);
}
