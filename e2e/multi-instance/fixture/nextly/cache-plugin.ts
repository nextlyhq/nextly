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

/** The context this instance gave the plugin when it started. */
let context: PluginContext | undefined;

export const fixtureCachePlugin = definePlugin({
  name: PLUGIN,
  version: "1.0.0",
  nextly: ">=0.0.1",
  init: ctx => {
    context = ctx;
  },
});

/** Expires the plugin's read on every instance. Call once Nextly has started. */
export async function expirePluginNote(): Promise<void> {
  if (!context) throw new Error("the fixture plugin was not started");
  await context.cache.expire(PART);
}
