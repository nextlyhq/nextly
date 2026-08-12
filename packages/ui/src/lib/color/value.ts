/**
 * The value a colour control hands back.
 *
 * A styling surface has two different things to say about a colour, and they
 * are not interchangeable. A LITERAL is the colour itself and never changes. A
 * TOKEN REFERENCE names something the site defines, so re-theming moves every
 * value that points at it — which is the whole reason a token exists, and is
 * lost the moment a control resolves one to its colour before storing it.
 *
 * So the value is the union, and it is structurally the same shape the block
 * engine already stores (`{ $token }` beside a literal). Declared here rather
 * than imported: this package publishes browser components and takes no
 * dependency on the engine.
 *
 * What is deliberately NOT here is the mapping from a token name to the CSS
 * custom property it compiles to. The engine owns that, applies a site-chosen
 * prefix to it, and validates the name; restating it here would be a second
 * implementation of a decision that already has one. A caller that needs the
 * colour of a token resolves it through a lookup the host supplies.
 *
 * @module lib/color/value
 */

/**
 * A reference to a colour the site defines, by dot path (`color.primary`).
 *
 * @experimental
 */
export interface ColorTokenValue {
  $token: string;
}

/**
 * A colour control's value: a literal in any CSS notation, or a token
 * reference.
 *
 * @experimental
 */
export type ColorValue = string | ColorTokenValue;

/**
 * Whether a value names a token rather than being a colour.
 *
 * Accepts only a PLAIN object. The prototype check is what does that work, and
 * it excludes arrays and class instances alike — an array is the case worth
 * naming, because it passes a bare `typeof === "object"` test, and a value that
 * reached storage through one serializes to `[]` and loses the token.
 *
 * @experimental
 */
export function isColorTokenValue(value: unknown): value is ColorTokenValue {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  // The marker must be the object's OWN. An inherited `$token` — from a
  // polluted `Object.prototype` — is not something this value carries, and
  // serializing it drops the property, so a caller that stored it would find
  // `{}` where a token had been.
  if (!Object.hasOwn(value, "$token")) return false;
  return typeof (value as { $token: unknown }).$token === "string";
}

/**
 * The token a value names, or null when it is a literal colour.
 *
 * @experimental
 */
export function colorTokenName(value: ColorValue): string | null {
  return isColorTokenValue(value) ? value.$token : null;
}

/**
 * The colour a value stands for, given the site's tokens.
 *
 * `tokens` is supplied by the host because it is the host that knows them: they
 * are site settings, they carry a value per light/dark mode, and which mode is
 * showing is the host's decision. A token absent from the lookup answers null
 * rather than falling back to some other colour — a swatch that renders the
 * wrong colour confidently is worse than one that renders nothing.
 *
 * @experimental
 */
export function resolveColorValue(
  value: ColorValue,
  tokens: Readonly<Record<string, string>> = {}
): string | null {
  // Narrowed rather than returned as-is. The TYPE admits shapes the predicate
  // rejects — a class instance carrying `$token` satisfies `ColorTokenValue`
  // structurally — so this branch can hold an object, and handing one back
  // would break the `string | null` this promises for every rendering caller.
  if (!isColorTokenValue(value)) {
    return typeof value === "string" ? value : null;
  }
  // Own keys only. A token name is a dot path with no reserved words, so
  // `constructor` and `toString` are legal names — and reading them off an
  // ordinary object walks the prototype and answers with a FUNCTION, which is
  // neither a colour nor the null this promises.
  if (!Object.hasOwn(tokens, value.$token)) return null;
  const resolved: unknown = tokens[value.$token];
  return typeof resolved === "string" ? resolved : null;
}
