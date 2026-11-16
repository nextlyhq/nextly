/**
 * A fresh opaque id made in the browser: one implementation for every id the
 * admin mints before the server sees it, such as a dashboard card's placement
 * or a new repeater row.
 *
 * @module lib/fresh-id
 */

let fallbackCounter = 0;

/**
 * `crypto.randomUUID` where it exists, and a counter-plus-random fallback,
 * starting with `prefix`, where it does not: jsdom without a secure context,
 * and older browsers, both leave it undefined. The fallback does not need to
 * be unguessable: these ids are opaque within one value and never a secret,
 * so uniqueness is the whole requirement.
 */
export function freshId(prefix: string): string {
  const generator = globalThis.crypto;
  if (typeof generator?.randomUUID === "function") {
    return generator.randomUUID();
  }
  fallbackCounter += 1;
  return `${prefix}-${Date.now()}-${fallbackCounter}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}
