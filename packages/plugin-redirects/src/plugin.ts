/**
 * @nextlyhq/plugin-redirects — admin-managed redirects for Nextly.
 *
 * Mirrors Payload's `@payloadcms/plugin-redirects`: it owns a `redirects`
 * collection (D12) + a `manage-redirects` permission (D36) and exposes a public
 * lookup route (D25/D28) that resolves a path via the D56 `where` query. The
 * actual interception is done by the app via the shipped Next.js middleware
 * helper (`@nextlyhq/plugin-redirects/middleware`) — plugin routes are
 * namespaced, so transparent root-path redirects live in the app, not the
 * plugin (same model as Payload).
 */
import { definePlugin, type PluginDefinition } from "@nextlyhq/plugin-sdk";

import { redirectsCollection } from "./collection";
import { findRedirect } from "./lookup";

export interface RedirectsPluginOptions {
  /** Slug for the redirects collection (default `"redirects"`). */
  slug?: string;
}

export interface RedirectsPluginResult {
  /** Plugin definition — pass to `defineConfig({ plugins: [...] })`. */
  plugin: PluginDefinition;
}

/**
 * Create a redirects plugin instance.
 *
 * @example
 * ```ts
 * import { defineConfig } from "nextly/config";
 * import { redirects } from "@nextlyhq/plugin-redirects";
 *
 * export default defineConfig({ plugins: [redirects().plugin] });
 * ```
 */
export function redirects(
  opts: RedirectsPluginOptions = {}
): RedirectsPluginResult {
  const slug = opts.slug ?? "redirects";

  const plugin = definePlugin({
    name: "@nextlyhq/plugin-redirects",
    // Keep in sync with package.json `version` (guarded by package-metadata.test).
    version: "0.0.2-alpha.22",
    nextly: ">=0.0.2-alpha.21",
    contributes: {
      collections: [redirectsCollection(slug)],
      permissions: [
        {
          action: "manage",
          resource: "redirects",
          label: "Manage Redirects",
          description: "Manage URL redirects",
          group: "Redirects",
        },
      ],
      // Public lookup route (D25/D28): the middleware helper calls it with the
      // incoming path; reads the redirects collection via the D56 `where`
      // query as system. Redirects are public routing data, not secrets.
      routes: [
        {
          method: "GET",
          path: "/lookup",
          public: true,
          handler: async (req, ctx) => {
            const from = new URL(req.url).searchParams.get("from");
            if (!from) return Response.json(null);
            const match = await findRedirect(ctx.services, slug, from);
            return Response.json(match);
          },
        },
      ],
    },
  });

  return { plugin };
}
