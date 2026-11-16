/**
 * Whether a response's `Cache-Control` lets a shared cache (a CDN, a proxy)
 * keep it and serve it without asking the origin: what a prebuilt admin page
 * promises, so a visitor is answered while the server is still starting.
 *
 * Judged by what the header grants, not by what it lacks. A response with no
 * lifetime, or one a cache must revalidate (`no-cache`, `max-age=0`), is not
 * kept in any useful sense, though it says neither `private` nor `no-store`.
 *
 * @param {string | null | undefined} cacheControl the header's value
 * @returns {boolean}
 */
export function sharedCacheMayKeep(cacheControl) {
  /** @type {Map<string, string | undefined>} */
  const directives = new Map();
  for (const part of (cacheControl ?? "").split(",")) {
    const [name, value] = part.trim().split("=");
    if (name) directives.set(name.toLowerCase(), value?.trim());
  }
  for (const refusal of ["private", "no-store", "no-cache"]) {
    if (directives.has(refusal)) return false;
  }
  // A shared cache takes `s-maxage` over `max-age` (RFC 9111, 5.2.2.10).
  const lifetime = directives.has("s-maxage")
    ? directives.get("s-maxage")
    : directives.get("max-age");
  return Number(lifetime) > 0;
}
