/**
 * `@nextlyhq/plugin-seo` — the first-party SEO plugin for Nextly.
 *
 * Opt-in and framework-agnostic (zero `next` dependency): it adds an SEO field
 * group to the collections you name and declares a `manage-seo` permission. A
 * later Tier-0 PR adds the agnostic sitemap; the Next-only metadata/routing
 * bridges live in `nextly/runtime`, never here, so this plugin is safe in every
 * deployment mode (integrated site, headless, internal admin).
 *
 * @module plugin
 */
import { createRequire } from "node:module";

import { definePlugin, type PluginDefinition } from "@nextlyhq/plugin-sdk";
import type { FieldConfig } from "nextly";

import { defaultSeoFields } from "./fields";

// Read the version from package.json so the plugin's declared version can never
// drift from what actually ships (mirrors @nextlyhq/plugin-form-builder).
const require = createRequire(import.meta.url);
const { version: PLUGIN_VERSION } = require("../package.json") as {
  version: string;
};

export interface SeoPluginOptions {
  /**
   * The collections to extend with the SEO field group (and, in later Tier-0
   * PRs, include in the sitemap). SEO is added ONLY to these — collections you
   * do not name are untouched.
   */
  collections: string[];
  /**
   * Override the contributed SEO fields. Defaults to {@link defaultSeoFields}
   * (a `seo` group: metaTitle, metaDescription, ogImage, canonical, noindex).
   */
  fields?: FieldConfig[];
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
  const fields = options.fields ?? defaultSeoFields();

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
    category: "seo",
    tags: ["seo", "sitemap", "metadata"],
    contributes: {
      // Add the SEO field group to each named collection (D12 extend).
      extend: [{ target: options.collections, fields }],
      // A custom, non-CRUD permission for gating SEO management. Declared here,
      // granted per-role by the project (never auto-granted).
      permissions: [
        {
          action: "manage",
          resource: "seo",
          label: "Manage SEO",
          description: "Edit SEO metadata and control search-engine indexing.",
        },
      ],
    },
  });
}
