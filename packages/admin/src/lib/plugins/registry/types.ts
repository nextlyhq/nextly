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
  install: {
    /** What to pass to the package manager. */
    package: string;
    /** The line to add inside `plugins: [...]` in nextly.config.ts. */
    configSnippet: string;
  };
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
