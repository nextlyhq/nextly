/**
 * How a route table pattern (`/admin/collections/[slug]/[id]`) matches an
 * address. Imports nothing, so the router and anything that must read an
 * address the way the router does (the loading outline, before the route's
 * code is known) share one reading without importing the page table.
 *
 * @module lib/route-pattern
 */

/** A pattern with its Next.js route groups, parallel slots and interceptions taken out. */
function normalizePattern(pattern: string): string {
  return pattern
    .replace(/\([^)]*\)\//g, "") // strip route groups (auth) → ""
    .replace(/\/@[^/]+/g, "") // strip parallel segments @slot → ""
    .replace(/\(\.\)(\w+)/g, "$1"); // intercepting routes (.)edit → edit
}

/** A route pattern as an anchored regular expression, with its parameters' names in order. */
export function routePatternRegex(pattern: string): {
  regex: RegExp;
  keys: string[];
} {
  const keys: string[] = [];
  pattern = normalizePattern(pattern);

  const regexStr = pattern
    .replace(/\//g, "\\/") // escape slashes
    .replace(/\[\.\.\.(\w+)\]/g, (_, key) => {
      keys.push(key);
      return "(.*)"; // catch-all
    })
    .replace(/\[\[\.\.\.(\w+)\]\]/g, (_, key) => {
      keys.push(key);
      return "(.*)?"; // optional catch-all
    })
    .replace(/\[(\w+)\]/g, (_, key) => {
      keys.push(key);
      return "([^\\/]+)"; // single param
    });

  return { regex: new RegExp("^" + regexStr + "$"), keys };
}
