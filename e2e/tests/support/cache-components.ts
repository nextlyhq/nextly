import { playgroundCacheComponents } from "../../../apps/playground/cache-components";

/**
 * Whether the playground under test was built with Cache Components: the rule
 * its `next.config.ts` builds from, read from the same environment, which the
 * suite's web server inherits.
 */
export const CACHE_COMPONENTS = playgroundCacheComponents();
