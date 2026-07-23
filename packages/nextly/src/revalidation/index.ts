/**
 * Cache-revalidation primitive (F1): framework-neutral tag computation and the
 * {@link CacheRevalidator} sink contract. The write path computes a
 * {@link RevalidationIntent} here (Node-safe, no `next/*`); the framework adapter
 * later flushes it to the underlying cache.
 */
export {
  collectionTag,
  computeEntryRevalidation,
  computeSingleRevalidation,
  entryIdLocaleTag,
  entryIdTag,
  entrySlugTag,
  singleTag,
} from "./compute-tags";
export type {
  CacheRevalidator,
  EntryRevalidationInput,
  RevalidateConfig,
  RevalidatePathTarget,
  RevalidationIntent,
  SingleRevalidationInput,
} from "./types";
