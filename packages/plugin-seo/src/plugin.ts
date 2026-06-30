/**
 * @nextlyhq/plugin-seo — a first-party SEO plugin for Nextly.
 *
 * - Extends the named content collections with SEO meta fields.
 * - Declares a `manage-seo` permission.
 * - Serves a public sitemap of published entries, namespaced under
 *   `/api/plugins/@nextlyhq/plugin-seo/sitemap.xml`, cached and
 *   invalidated on collection change events.
 *
 * Authored against `@nextlyhq/plugin-sdk` — the stable, experimental boundary.
 */
import { definePlugin, type PluginDefinition } from "@nextlyhq/plugin-sdk";
import type { FieldConfig } from "nextly";

import { defaultSeoFields } from "./fields";
import { createSitemapCache } from "./sitemap";

/** A content document as seen by the sitemap builder (loose by design). */
export type SeoEntry = Record<string, unknown> & {
  slug?: string;
  updatedAt?: string | Date | null;
};

export interface SeoPluginOptions {
  /** Collections to extend with SEO fields AND include in the sitemap. */
  collections: string[];
  /** Absolute base URL for sitemap `<loc>` (e.g. "https://example.com"). */
  baseUrl: string;
  /**
   * Build the path for an entry. Defaults to `/<collection>/<entry.slug>`.
   * Return a leading-slash path; it is appended to `baseUrl`.
   */
  urlFor?: (entry: SeoEntry, collection: string) => string;
  /** Override the contributed SEO fields (defaults to metaTitle + metaDescription). */
  fields?: FieldConfig[];
}

export interface SeoPluginResult {
  /** Plugin definition — pass to `defineConfig({ plugins: [...] })`. */
  plugin: PluginDefinition;
}

/** Default URL builder: `/<collection>/<slug>`. */
export function defaultUrlFor(entry: SeoEntry, collection: string): string {
  return `/${collection}/${entry.slug ?? ""}`;
}

/**
 * Create an SEO plugin instance.
 *
 * @example
 * ```ts
 * import { defineConfig } from "nextly/config";
 * import { seo } from "@nextlyhq/plugin-seo";
 *
 * export default defineConfig({
 *   plugins: [seo({ collections: ["pages", "posts"], baseUrl: "https://example.com" }).plugin],
 * });
 * ```
 */
export function seo(opts: SeoPluginOptions): SeoPluginResult {
  const fields = opts.fields ?? defaultSeoFields();
  // One cache per plugin instance, shared by the route handler (reads it) and
  // the change-event subscriptions (invalidate it).
  const sitemap = createSitemapCache(opts);

  const plugin = definePlugin({
    name: "@nextlyhq/plugin-seo",
    // Keep in sync with package.json `version` (guarded by package-metadata.test).
    version: "0.0.2-alpha.22",
    nextly: ">=0.0.2-alpha.21",
    contributes: {
      // D12: add the same SEO fields to every target collection.
      extend: [{ target: opts.collections, fields }],
      // D36: a custom permission for SEO management (defined, never granted).
      permissions: [
        {
          action: "manage",
          resource: "seo",
          label: "Manage SEO",
          description: "Manage SEO metadata and the sitemap",
          group: "SEO",
        },
      ],
      // D25/D28: public sitemap, namespaced under
      // /api/plugins/@nextlyhq/plugin-seo/sitemap.xml. Apps expose it at the
      // root via a next.config rewrite (see README).
      routes: [
        {
          method: "GET",
          path: "/sitemap.xml",
          public: true,
          handler: async (_req, ctx) => {
            const xml = await sitemap.get(ctx.services);
            return new Response(xml, {
              headers: { "content-type": "application/xml; charset=utf-8" },
            });
          },
        },
      ],
    },
    // D8/D51: invalidate the cached sitemap when any target collection changes.
    init(ctx) {
      // Subscriptions are idempotent across HMR — the platform clears a
      // plugin's prior subscriptions before re-init (B2), so no guard is needed.
      for (const slug of opts.collections) {
        for (const action of ["created", "updated", "deleted"] as const) {
          ctx.events.on(`collection.${slug}.${action}`, () =>
            sitemap.invalidate()
          );
        }
      }
    },
  });

  return { plugin };
}
