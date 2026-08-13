import { REGISTRY_ENTRIES } from "./entries";
import { FEATURED_IDS } from "./featured";
import type { PluginRegistrySource, RegistryPlugin } from "./types";

/** Cap on the curated strip. Enforced by the registry test, not by a comment. */
export const MAX_FEATURED = 3;

/**
 * Whether a curated strip is worth rendering at all.
 *
 * A "featured" section that contains every entry is not a recommendation, it
 * is the list with a second heading. With three plugins in the catalogue that
 * is a live concern rather than a hypothetical, so the strip earns its place
 * only while it is a strict subset with something left over in the grid.
 *
 * Exported so the page and the test ask the same question, rather than the
 * page embedding a threshold the test restates.
 */
export function shouldShowFeatured(
  entries: readonly RegistryPlugin[],
  featuredIds: readonly string[]
): boolean {
  return featuredIds.length > 0 && entries.length > featuredIds.length;
}

/**
 * The in-repo catalogue.
 *
 * Resolves instantly; the interface is async by design so a remote source can
 * replace this without touching a consumer.
 *
 * @module lib/plugins/registry/static-source
 */
export const staticRegistrySource: PluginRegistrySource = {
  // `Promise.resolve` rather than an `async` body: the interface is async so a
  // remote source can replace this, but there is nothing here to await and an
  // async function that never awaits is a lint error rather than a signal.
  list: () => Promise.resolve(REGISTRY_ENTRIES),
  featured: () => Promise.resolve(FEATURED_IDS),
};
