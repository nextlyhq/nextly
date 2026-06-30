/**
 * Bridge plugin-contributed view overrides (`contributes.admin.views`, D23)
 * onto the collection-level `admin.components` shape the admin already resolves
 * (`schemas/dynamic-collections/types.ts`). Pure + immutable.
 *
 * Collision policy (read path — never throws): a slot already set on the
 * collection (Builder/code-first) or by an earlier plugin WINS; plugin views
 * only fill empty slots. This keeps host/Builder choices authoritative and
 * avoids surfacing a 500 on a GET.
 *
 * @module plugins/admin-views
 */

import type { PluginDefinition } from "./plugin-context";

/** Minimal structural shape of a collection carrying admin component overrides. */
export interface CollectionWithAdmin {
  slug: string;
  admin?: {
    components?: {
      views?: {
        Edit?: { Component: string };
        List?: { Component: string };
      };
      BeforeListTable?: string;
      AfterListTable?: string;
      BeforeEdit?: string;
      AfterEdit?: string;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface AdminComponents {
  views?: {
    Edit?: { Component: string };
    List?: { Component: string };
  };
  BeforeListTable?: string;
  AfterListTable?: string;
  BeforeEdit?: string;
  AfterEdit?: string;
}

/** Resolve a plugin's declared view slug through its renameMap. */
function resolvedSlug(plugin: PluginDefinition, declared: string): string {
  return plugin.renameMap?.[declared] ?? declared;
}

/**
 * Fold each enabled plugin's `contributes.admin.views[slug]` into the matching
 * collection's `admin.components`. Returns new collection objects; inputs are
 * not mutated.
 */
export function applyPluginAdminViews<C extends CollectionWithAdmin>(
  collections: C[],
  plugins: PluginDefinition[]
): C[] {
  // Build slug → merged overrides from all enabled plugins.
  const bySlug = new Map<string, AdminComponents>();

  for (const plugin of plugins) {
    if (plugin.enabled === false) continue; // D49
    const views = plugin.contributes?.admin?.views;
    if (!views) continue;

    for (const [declared, view] of Object.entries(views)) {
      const slug = resolvedSlug(plugin, declared);
      const target = bySlug.get(slug) ?? {};

      if (view.edit && !target.views?.Edit) {
        target.views = { ...target.views, Edit: { Component: view.edit } };
      }
      if (view.list && !target.views?.List) {
        target.views = { ...target.views, List: { Component: view.list } };
      }
      if (view.beforeList && target.BeforeListTable === undefined) {
        target.BeforeListTable = view.beforeList;
      }
      if (view.afterList && target.AfterListTable === undefined) {
        target.AfterListTable = view.afterList;
      }
      if (view.beforeEdit && target.BeforeEdit === undefined) {
        target.BeforeEdit = view.beforeEdit;
      }
      if (view.afterEdit && target.AfterEdit === undefined) {
        target.AfterEdit = view.afterEdit;
      }

      bySlug.set(slug, target);
    }
  }

  if (bySlug.size === 0) return collections;

  return collections.map(collection => {
    const overrides = bySlug.get(collection.slug);
    if (!overrides) return collection;

    const existing: AdminComponents = collection.admin?.components ?? {};

    // Existing (collection/Builder) slots win; plugin fills only empties.
    const mergedViews =
      overrides.views || existing.views
        ? {
            ...overrides.views,
            ...existing.views, // existing wins
          }
        : undefined;

    const components: AdminComponents = {
      ...overrides,
      ...existing, // existing top-level slots win
    };
    if (mergedViews) components.views = mergedViews;

    return {
      ...collection,
      admin: { ...collection.admin, components },
    };
  });
}
