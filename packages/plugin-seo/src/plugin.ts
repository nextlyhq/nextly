/**
 * `@nextlyhq/plugin-seo` — the first-party SEO plugin for Nextly.
 *
 * Opt-in and framework-agnostic (zero `next` dependency): it adds an SEO field
 * group to the collections you name, so it stays usable in every deployment
 * mode (integrated site, headless, internal admin).
 *
 * @module plugin
 */
import { createRequire } from "node:module";

import {
  definePlugin,
  group,
  type FieldConfig,
  type PluginContributions,
  type PluginDefinition,
} from "@nextlyhq/plugin-sdk";

import { defaultSeoFields } from "./fields";
import {
  generateSitemap,
  resolveBaseOrigin,
  type UrlForEntry,
} from "./sitemap";

// Read the version from package.json so the plugin's declared version can never
// drift from what actually ships (mirrors @nextlyhq/plugin-form-builder).
const require = createRequire(import.meta.url);
const { version: PLUGIN_VERSION } = require("../package.json") as {
  version: string;
};

export interface SeoPluginOptions {
  /**
   * The collections to extend with the SEO field group. SEO is added ONLY to
   * these — collections you do not name are untouched.
   */
  collections: string[];
  /**
   * The fields placed INSIDE the `seo` group. Defaults to
   * {@link defaultSeoFields} (metaTitle, metaDescription, ogImage, canonical,
   * noindex). Custom fields are still nested under `seo` (e.g. a `focusKeyword`
   * override lands at `entry.seo.focusKeyword`), so consumers always read SEO
   * data from one predictable place.
   */
  fields?: FieldConfig[];
  /**
   * Absolute site origin used for `<loc>` in the generated sitemap
   * (e.g. "https://example.com", no trailing slash). When omitted, the sitemap
   * route derives the origin from the incoming request — correct for a
   * single-origin deployment, but wrong behind a proxy that rewrites the host,
   * so set it explicitly there.
   */
  baseUrl?: string;
  /**
   * Build the URL path for a sitemap entry (leading slash, appended to the
   * origin). Defaults to `/<collection>/<slug>`. Override it to match your
   * routing (e.g. posts served at `/blog/:slug`).
   */
  urlFor?: UrlForEntry;
  /**
   * Controls the public sitemap route. `true` (the default) serves a sitemap of
   * the `collections` above. `false` omits the route entirely. Pass
   * `{ collections: [...] }` to advertise only a subset.
   *
   * The sitemap is PUBLIC and lists every published entry's URL as system, so it
   * bypasses per-collection read access. Exclude any collection whose entries
   * should not be publicly enumerable (owner-only, role-gated, or internal) by
   * narrowing this list or disabling the route.
   */
  sitemap?: boolean | { collections?: string[] };
}

/**
 * Create the SEO plugin. Register it directly in your config — no unwrapping:
 *
 * @example
 * ```ts
 * import { defineConfig } from "nextly/config";
 * import { seoPlugin } from "@nextlyhq/plugin-seo";
 *
 * export default defineConfig({
 *   plugins: [seoPlugin({ collections: ["pages", "posts"] })],
 * });
 * ```
 */
export function seoPlugin(options: SeoPluginOptions): PluginDefinition {
  // Always nest the fields (default or custom) under a single `seo` group so
  // every project exposes SEO consistently at `entry.seo.*`.
  const seoGroup = group({
    name: "seo",
    label: "SEO",
    fields: options.fields ?? defaultSeoFields(),
  });

  // Dedupe once: a repeated slug would make the schema-extend fold add `seo`
  // twice (a duplicate-field error), and would list the same URLs twice in the
  // sitemap.
  const targets = [...new Set(options.collections)];

  // The sitemap is on by default; `sitemap: false` disables the route, and
  // `{ collections }` narrows which collections it advertises (defaulting to the
  // SEO collections). Kept separate from `targets` so a private collection can
  // carry SEO fields without being enumerated in the public sitemap.
  const sitemapEnabled = options.sitemap !== false;

  // A configured baseUrl must be an absolute http(s) ORIGIN — otherwise every
  // `<loc>` is invalid (or doubles a base path). Validate at construction (same
  // rule the generator applies) so a misconfig fails fast — but only when the
  // sitemap is enabled, since a disabled route never consumes baseUrl.
  if (sitemapEnabled && options.baseUrl !== undefined) {
    resolveBaseOrigin(options.baseUrl);
  }
  const sitemapTargets =
    options.sitemap &&
    typeof options.sitemap === "object" &&
    options.sitemap.collections
      ? [...new Set(options.sitemap.collections)]
      : targets;

  // A sitemap subset must be a subset of the SEO collections. A slug outside
  // them is never extended, so it would only surface at request time as a 500
  // (metadata lookup on an unknown collection) — fail fast at construction.
  const unknownSitemap = sitemapTargets.filter(slug => !targets.includes(slug));
  if (unknownSitemap.length > 0) {
    throw new Error(
      `seoPlugin: sitemap.collections must be a subset of collections; ` +
        `unknown: ${unknownSitemap.join(", ")}`
    );
  }

  const contributes: PluginContributions = {
    // Add the SEO group to each named collection.
    extend: [{ target: targets, fields: [seoGroup] }],
  };

  if (sitemapEnabled) {
    // Serve a sitemap of published entries over HTTP, mounted at
    // /api/plugins/@nextlyhq/plugin-seo/sitemap.xml. Public so crawlers and
    // headless frontends (which have no Next `app/sitemap.ts`) can read it.
    // The document is generated per request (agnostic, no `next`); ISR caching
    // of the canonical `/sitemap.xml` belongs to the Next delivery layer, and
    // headless consumers cache at their edge.
    contributes.routes = [
      {
        method: "GET",
        path: "/sitemap.xml",
        public: true,
        handler: async (req, ctx) => {
          // A single-origin deployment can rely on the request origin; a
          // proxied one must configure `baseUrl` so `<loc>` uses the public
          // host rather than the internal one.
          const configuredBaseUrl = options.baseUrl;
          const baseUrl = configuredBaseUrl ?? new URL(req.url).origin;
          const xml = await generateSitemap(ctx.services, {
            collections: sitemapTargets,
            baseUrl,
            urlFor: options.urlFor,
          });
          const headers: Record<string, string> = {
            "content-type": "application/xml; charset=utf-8",
          };
          if (!configuredBaseUrl) {
            // The origin came from the (spoofable) request Host — keep an
            // intermediary from caching a host-derived document and serving it
            // for a different host. Configure `baseUrl` for a cacheable sitemap.
            headers["cache-control"] = "no-store";
          }
          return new Response(xml, { headers });
        },
      },
    ];
  }

  return definePlugin({
    name: "@nextlyhq/plugin-seo",
    version: PLUGIN_VERSION,
    // Core-compat range (the field is literally `nextly`). Kept wide: the
    // plugin only uses stable field factories + the `@public` plugin surface.
    nextly: ">=0.0.2-alpha.21",
    author: "Nextly <contact@nextlyhq.com> (https://nextlyhq.com)",
    homepage: "https://nextlyhq.com",
    repository: "https://github.com/nextlyhq/nextly",
    license: "MIT",
    // How the plugin presents itself wherever the admin lists it. Without a
    // description the plugins list shows a bare name, which says nothing about
    // what installing this does. The other first-party plugins declare theirs
    // in the same place.
    admin: {
      description:
        "Add an SEO meta field group to your collections, with title, description and social preview fields",
    },
    category: "seo",
    tags: ["seo", "meta"],
    contributes,
  });
}
