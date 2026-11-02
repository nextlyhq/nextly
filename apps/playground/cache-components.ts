/**
 * Whether the playground runs with Cache Components and Partial Prefetching.
 *
 * On unless `NEXTLY_PLAYGROUND_CACHE_COMPONENTS` is `"0"`. On by default
 * because a new Next.js app starts with it on (`create-next-app` 16.4), so the
 * browser suite and every contributor's `pnpm dev:app` run the admin and the
 * content routes as such an app does. `"0"` is for the suite's leg with it
 * off, which an app `create-nextly-app` creates still builds with.
 *
 * One rule for `next.config.ts`, which builds the app, and for the browser
 * suite, which asks what it was built with (`e2e/tests/support/
 * cache-components.ts`), so the two cannot disagree.
 */
export function playgroundCacheComponents(
  env: Readonly<Record<string, string | undefined>> = process.env
): boolean {
  return env.NEXTLY_PLAYGROUND_CACHE_COMPONENTS !== "0";
}
