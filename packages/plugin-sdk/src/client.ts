/**
 * @nextlyhq/plugin-sdk/client — the author-facing React surface for plugin
 * admin UI (D36/D43). Import these in components rendered inside the Nextly
 * admin shell (which provides `@nextlyhq/admin` + React).
 *
 * @experimental No first-party plugin's admin UI calls `useCan`/`<Can>` yet;
 *   graduates to `@public` when one does (D55). See `STABILITY.md`.
 */
export { useCan, Can } from "@nextlyhq/admin";
export type { CanProps } from "@nextlyhq/admin";
