import type { PluginCategory } from "../plugin-categories";

/**
 * A plugin in the curated catalogue. Not necessarily installed.
 *
 * Distinct from `PluginMetadata`, which describes a plugin the server has
 * actually loaded. Everything here is a curated claim; nothing here has been
 * observed running. Callers must not render catalogue data inside a surface
 * that reports what an installed plugin contributes.
 *
 * @module lib/plugins/registry/types
 */
export interface RegistryPlugin {
  /**
   * npm package name, and the identity this joins to `PluginMetadata.name` on.
   * Also the source of the detail-page slug, via `pluginSlug`.
   */
  id: string;
  name: string;
  /** Required, unlike `PluginMetadata.description`: this catalogue is ours. */
  description: string;
  author: string;
  category: PluginCategory;
  tags?: string[];
  icon: { lucide: string; asset?: string };
  /**
   * The line to add inside `plugins: [...]` in nextly.config.ts.
   *
   * No package name beside it: that is `id`, and storing it twice means a
   * rename can update one and leave the other, so the detail page would join
   * on the new name while the install command still fetched the old one.
   * Derive the command with `installCommand()`.
   */
  configSnippet: string;
  links?: { homepage?: string; repository?: string; docs?: string };
}

/**
 * Where catalogue data comes from.
 *
 * Async although the only implementation resolves instantly. A synchronous
 * source teaches every consumer that the data is always present and never
 * fails, so the day it becomes remote (an npm keyword search, a hosted
 * registry) every consumer and every test is rewritten. Two states now cost
 * one await.
 */
export interface PluginRegistrySource {
  list(): Promise<RegistryPlugin[]>;
  /** Ordered ids for the curated strip, at most `MAX_FEATURED`. */
  featured(): Promise<string[]>;
}
