/**
 * `nextly/cache-handler`: the incremental cache handler for `next.config`'s
 * `cacheHandler`, with `cacheMaxMemorySize: 0`. Its entries expire for writes
 * made on any instance, or outside any request.
 *
 * ```ts
 * cacheHandler: require.resolve("nextly/cache-handler"),
 * cacheMaxMemorySize: 0,
 * ```
 *
 * @module cache-handler
 */
export { default } from "./runtime/cache/incremental-cache-handler";
