/**
 * `nextly/cache-handlers`: the `use cache` handler for `next.config`'s
 * `cacheHandlers.default`. Its entries expire for writes made on any instance,
 * or outside any request.
 *
 * ```ts
 * cacheHandlers: { default: require.resolve("nextly/cache-handlers") },
 * ```
 *
 * @module cache-handlers
 */
export { default } from "./runtime/cache/use-cache-handler";
