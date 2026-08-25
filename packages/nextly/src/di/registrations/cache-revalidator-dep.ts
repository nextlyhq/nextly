/**
 * The cache revalidator, as a service constructor needs it.
 *
 * Three write paths take this dependency — collections, singles and media — and
 * each took it by spelling the same lazy container lookup inline. One question
 * with three implementations is one that can be answered differently by
 * accident: a site that captures eagerly instead of resolving lazily compiles,
 * runs, and invalidates nothing, and the difference is four tokens.
 *
 * @module di/registrations/cache-revalidator-dep
 */

import type { CacheRevalidator } from "../../revalidation/types";
import type { Container } from "../container";

/**
 * A RESOLVER rather than the instance, and that is the whole point.
 *
 * A service that takes this is constructed during boot, before a Next cache
 * adapter registers — which happens at request time. Capturing the value here
 * would memoize whatever exists at boot (the no-op default) and ignore the real
 * adapter forever, so every write would report success while invalidating
 * nothing. Returning `undefined` when nothing is registered is the correct
 * answer for a deployment that does not cache.
 */
export function cacheRevalidatorDep(
  container: Container
): () => CacheRevalidator | undefined {
  return () =>
    container.has("cacheRevalidator")
      ? container.get<CacheRevalidator>("cacheRevalidator")
      : undefined;
}
