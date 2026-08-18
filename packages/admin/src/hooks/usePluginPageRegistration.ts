import { useEffect, useRef } from "react";

import { pluginSurfaceSection } from "@admin/lib/navigation/section-resolvers";
import { autoRegisterPluginComponents } from "@admin/lib/plugins/component-registry";
import {
  registerPluginPages,
  clearPluginPages,
  pluginPagePath,
} from "@admin/lib/plugins/plugin-route-registry";
import { pluginSlug } from "@admin/lib/plugins/plugin-slug";
import type { PluginMetadata } from "@admin/types/branding";

/** Order-independent signature of a set of registered plugin routes. */
function routeSignature(routes: string[]): string {
  return JSON.stringify([...routes].sort());
}

/**
 * Every component path a plugin's admin-meta entry can resolve by string:
 * pages, settings, the header slot (both spellings), the schema-builder and
 * form-toolbar slots, and custom field-type editors. All of them render
 * through the component registry, so their modules must be imported even for
 * a plugin that contributes no collections — the field-type and slot kinds
 * are delivered via branding rather than collection admin.components, and
 * nothing else would trigger their import. The import-map codegen in
 * `nextly` collects the same kinds; the parity test there fails when the two
 * disagree.
 */
function pluginComponentPaths(plugin: PluginMetadata): string[] {
  const headerSlot = plugin.header?.slot ?? plugin.headerSlot;
  return [
    ...(plugin.pages ?? []).map(page => page.component),
    plugin.settings?.component,
    headerSlot,
    plugin.schemaBuilderSlot,
    // The toolbar slot renders inside the entry form's provider, so it is
    // resolved on the same pages the schema-builder slot is.
    plugin.entryFormToolbarSlot,
    ...(plugin.fieldTypes ?? []).map(fieldType => fieldType.component),
  ].filter((path): path is string => path !== undefined);
}

/**
 * Registers one plugin's pages into the client route registry and returns
 * the signature entries describing what was registered.
 */
function registerPluginRoutes(plugin: PluginMetadata, slug: string): string[] {
  if (!plugin.pages || plugin.pages.length === 0) return [];

  registerPluginPages(
    slug,
    plugin.pages.map(page => ({
      path: page.path,
      component: page.component,
      requiredPermission: page.requiredPermission,
      section: pluginSurfaceSection(page.section, plugin.placement, slug),
    }))
  );

  // Key on the resolved route (the registry strips leading slashes, so
  // "/reports" and "reports" are one route) and encode the tuple as JSON,
  // since component and permission values can themselves contain the
  // delimiter — `posts:read` style permissions being the common case — which
  // a flat join would render ambiguous.
  return plugin.pages.map(page =>
    JSON.stringify([
      pluginPagePath(slug, page.path),
      page.component,
      page.requiredPermission ?? "",
    ])
  );
}

/**
 * Registers plugin-contributed admin pages into the client route registry
 * whenever the admin-meta plugin list changes, and triggers auto-registration
 * of their component modules (so `PluginSlot` can resolve them).
 *
 * Note: components are also self-registered by first-party plugin admin modules
 * on import; this additionally feeds page/settings paths for plugins that have
 * no collections to trigger their module import.
 */
export function usePluginPageRegistration(
  plugins: PluginMetadata[] | undefined
): void {
  // Signature of the plugin routes registered by the last run, so the effect
  // can tell an actual route change from an unrelated admin-meta change. Seeded
  // with the empty-set signature (built the same way as below, so the two
  // cannot drift) — the first run with no plugin pages is then not a change.
  const registeredRoutesRef = useRef(routeSignature([]));

  useEffect(() => {
    clearPluginPages();

    const componentPaths: string[] = [];
    const registeredRoutes: string[] = [];
    // `plugins` is undefined until admin-meta loads, and can come back without
    // pages if a plugin is disabled; both must still reach the change check
    // below so a removed route stops resolving.
    for (const plugin of plugins ?? []) {
      const slug = pluginSlug(plugin.name);
      registeredRoutes.push(...registerPluginRoutes(plugin, slug));
      componentPaths.push(...pluginComponentPaths(plugin));
    }

    if (componentPaths.length > 0) {
      void autoRegisterPluginComponents(componentPaths);
    }

    // Plugin routes register here, in an effect that runs after admin-meta
    // loads — later than `useRouter`'s one-time initial route resolution. On a
    // deep link or hard refresh to a plugin page, that first `resolveRoute` ran
    // before the registry was populated and returned a 404, and `useRouter`
    // only re-resolves on navigation or a `locationchange`. Emit that event
    // when the registered route set changes so the router re-resolves the
    // current path: a newly registered page renders instead of 404ing, and a
    // page that went away stops resolving instead of lingering until the next
    // navigation. Admin-meta refetches periodically, so comparing the route set
    // (rather than just "did anything register") keeps unrelated branding
    // changes from forcing a redundant re-resolution.
    const signature = routeSignature(registeredRoutes);
    const previousSignature = registeredRoutesRef.current;
    registeredRoutesRef.current = signature;
    if (signature !== previousSignature && typeof window !== "undefined") {
      window.dispatchEvent(new Event("locationchange"));
    }
  }, [plugins]);
}
