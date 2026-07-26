/**
 * `@nextlyhq/plugin-seo` — the first-party SEO plugin for Nextly.
 *
 * Opt-in and framework-agnostic (zero `next` dependency): it adds an SEO field
 * group to the collections you name. A later Tier-0 PR adds the agnostic
 * sitemap; the Next-only metadata/routing bridges live in `nextly/runtime`,
 * never here, so this plugin is safe in every deployment mode (integrated site,
 * headless, internal admin).
 *
 * @module plugin
 */
import { createRequire } from "node:module";

import { definePlugin, type PluginDefinition } from "@nextlyhq/plugin-sdk";
import { group } from "nextly";
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
   * The fields placed INSIDE the `seo` group. Defaults to
   * {@link defaultSeoFields} (metaTitle, metaDescription, ogImage, canonical,
   * noindex). Custom fields are still nested under `seo` (e.g. a `focusKeyword`
   * override lands at `entry.seo.focusKeyword`), so consumers always read SEO
   * data from one predictable place.
   */
  fields?: FieldConfig[];
  /**
   * Store SEO data per-locale (so translated pages get their own meta title,
   * description, canonical, etc.). Enable this ONLY when the target collections
   * have localization configured (`locales` + `defaultLocale`) — Nextly rejects
   * a localized field on a non-localized entity at config time. Defaults to
   * `false`, so the plugin is safe on monolingual projects.
   */
  localized?: boolean;
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
    // Per-locale SEO is opt-in: localizing the group on a non-localized
    // collection would fail config validation, so default to non-localized.
    localized: options.localized === true,
    fields: options.fields ?? defaultSeoFields(),
  });

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
      // Add the SEO group to each named collection (D12 extend).
      extend: [{ target: options.collections, fields: [seoGroup] }],
    },
  });
}
