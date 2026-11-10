/**
 * A plugin that expires a cached read of its own through `ctx.cache`, as a
 * plugin does when its settings change. Its read carries only the plugin's
 * tag, so a content write's expiry never reaches it: only this one does.
 */
import { definePlugin, pluginCacheTag, type PluginContext } from "nextly";

const PLUGIN = "fixture-cache";
const PART = "note";

/** The tag `ctx.cache.tag(PART)` gives, spelled from outside the context. */
export const PLUGIN_NOTE_TAG = pluginCacheTag(PLUGIN, PART);

/**
 * Where the context this instance gave the plugin is kept. On `globalThis`
 * rather than in this module: Next.js bundles each route on its own, so the
 * route that expires the read can hold a different copy of this module from
 * the one whose `init` ran. A real plugin calls `ctx.cache` from its own hooks
 * and routes, where it is handed `ctx`, and needs none of this.
 */
const CONTEXT = Symbol.for("nextly-e2e/fixture-cache-context");
const held = globalThis as { [CONTEXT]?: PluginContext };

export const fixtureCachePlugin = definePlugin({
  name: PLUGIN,
  version: "1.0.0",
  nextly: ">=0.0.1",
  init: ctx => {
    held[CONTEXT] = ctx;
  },
});

/** Expires the plugin's read on every instance. Call once Nextly has started. */
export async function expirePluginNote(): Promise<void> {
  const context = held[CONTEXT];
  if (!context) throw new Error("the fixture plugin was not started");
  await context.cache.expire(PART);
}
