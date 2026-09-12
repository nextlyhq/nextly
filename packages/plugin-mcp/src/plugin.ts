/**
 * `@nextlyhq/plugin-mcp` — the first-party Model Context Protocol server for
 * Nextly.
 *
 * EXPERIMENTAL. The package is published so its name is claimed and its release
 * train is proven, and so that the protocol surface can land in small reviewable
 * pieces rather than as one drop. It contributes NOTHING yet: installing it
 * today changes no route, no field and no permission, which
 * `__tests__/plugin.test.ts` asserts rather than leaves to be believed.
 *
 * Framework-agnostic by construction. The protocol surface is a request
 * handler, so nothing here couples to `next` or `react` and a headless install
 * exposes exactly what one running the admin panel does.
 *
 * @module plugin
 */
import { createRequire } from "node:module";

import { definePlugin, type PluginDefinition } from "@nextlyhq/plugin-sdk";

// Read from the manifest so the declared version cannot drift from what ships.
// A hand-copied string agrees on the day it is written; this is the same reason
// the other first-party plugins read theirs.
const require = createRequire(import.meta.url);
const { version: PLUGIN_VERSION } = require("../package.json") as {
  version: string;
};

export interface McpPluginOptions {
  /**
   * Serve the protocol endpoint. Defaults to `false`, and stays the default
   * while the surface is experimental.
   *
   * Off is the only safe default for this one. What it exposes is an install's
   * schema and content to any client that can reach the route, so a version
   * bump that silently began serving would widen what is readable without
   * anybody deciding to. An operator turns this on.
   */
  enabled?: boolean;
}

/**
 * The Nextly plugin.
 *
 * Takes its options now so that enabling the surface later is a value change
 * rather than a signature change for everyone who has already installed it.
 */
export function mcpPlugin(options: McpPluginOptions = {}): PluginDefinition {
  const { enabled = false } = options;

  return definePlugin({
    // Carried on the definition, not merely resolved. Core reads an OMITTED
    // `enabled` as enabled (`plugin.enabled !== false`), so a definition that
    // resolves the option and drops it reports this plugin as on — including
    // for a caller that passed `enabled: false` and read the default as off.
    enabled,
    name: "@nextlyhq/plugin-mcp",
    version: PLUGIN_VERSION,
    // Core-compat floor is the version exporting everything this imports. It is
    // the plugin contract alone today; it rises when the transport reaches for
    // a newer core export, and stating a wider range would advertise a
    // compatibility whose ESM import fails at module load.
    nextly: ">=0.0.2-alpha.65",
    author: "Nextly <contact@nextlyhq.com> (https://nextlyhq.com)",
    homepage: "https://nextlyhq.com",
    repository: "https://github.com/nextlyhq/nextly",
    license: "MIT",
    admin: {
      description:
        "Experimental. Exposes this install's schema and content to AI agents over the Model Context Protocol, read-only. Off until enabled.",
    },
  });
}
