import { definePlugin } from "@nextlyhq/plugin-sdk";

import { Examples } from "./collections/example";
import type { MyPluginOptions } from "./types";

/**
 * Your plugin factory. Call it in a host app's `defineConfig({ plugins: [...] })`.
 *
 * @example
 * ```ts
 * import { myPlugin } from "{{pluginName}}";
 * export default defineConfig({ plugins: [myPlugin({ greeting: "Hi" })] });
 * ```
 */
export const myPlugin = (opts: MyPluginOptions = {}) =>
  definePlugin({
    name: "{{pluginName}}",
    version: "0.1.0",
    nextly: "{{nextlyRange}}",
    enabled: opts.enabled,
    contributes: {
      collections: [Examples],
      permissions: [
        { action: "manage", resource: "examples", label: "Manage Examples" },
      ],
      admin: {
        menu: [
          {
            label: "Examples",
            to: "/admin/collections/examples",
            icon: "Sparkles",
          },
        ],
        settings: { component: "{{pluginName}}/admin#SettingsPage" },
      },
    },
    init(ctx) {
      const greeting = opts.greeting ?? "Hello";
      // Resolve your own slug via ctx.self so this keeps working if the host
      // renames the collection (D54). React to the post-commit create event.
      ctx.events.on(`collection.${ctx.self.collections.examples}.created`, () =>
        ctx.logger.info(`${greeting} from {{pluginName}} — example created`)
      );
    },
    destroy() {
      // Clean up here (subscriptions are auto-dropped on registry reset).
    },
  });
