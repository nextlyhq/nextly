/**
 * How the page builder's own ready-made content writes its styles: the
 * starter header and footer, and the starter pages. One spelling of a
 * variable, a box's four sides and a style for every width, so the two
 * never write the same style two ways.
 *
 * @module starter-style
 */

/** A variable, by its identity: a site's value wherever it is drawn. */
export function token(name: string): { readonly $token: string } {
  return { $token: name };
}

/** A box's four sides: the same at the block ends, and at the inline ends. */
export function sides(
  block: unknown,
  inline: unknown = block
): {
  readonly blockStart: unknown;
  readonly blockEnd: unknown;
  readonly inlineStart: unknown;
  readonly inlineEnd: unknown;
} {
  return {
    blockStart: block,
    blockEnd: block,
    inlineStart: inline,
    inlineEnd: inline,
  };
}

/** Styles at every width and in every state. */
export function styled(base: Record<string, unknown>): {
  readonly base: { readonly base: Record<string, unknown> };
} {
  return { base: { base } };
}
