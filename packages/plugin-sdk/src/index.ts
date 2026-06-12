/**
 * @nextlyhq/plugin-sdk — the public, author-facing plugin surface (D43).
 *
 * This package IS the stability boundary (D40). Everything re-exported here is
 * `@experimental` until first-party plugins have exercised it (D55). `ctx.services`
 * is the highest-scrutiny surface and stays experimental the longest.
 *
 * Added in later phases: `useCan`/`<Can>` (P3/P5). `createTestNextly` (P1) lives
 * on the `@nextlyhq/plugin-sdk/testing` subpath.
 */
export { definePlugin } from "nextly";

export type {
  PluginDefinition,
  PluginContributions,
  PluginContext,
  PluginHookRegistry,
} from "nextly";

export type { HookType, HookHandler, HookContext } from "nextly";

// Event bus (D8/D51) — `ctx.events` surface + types.
export type { EventBus, EventEnvelope, EventHandler, EventName } from "nextly";
