import { useEffect, useRef } from "react";

import { autoRegisterPluginComponents } from "@admin/lib/plugins/component-registry";
import {
  registerPluginPages,
  clearPluginPages,
  pluginPagePath,
} from "@admin/lib/plugins/plugin-route-registry";
import type { PluginMetadata } from "@admin/types/branding";

/** Order-independent signature of a set of registered plugin routes. */
function routeSignature(routes: string[]): string {
  return JSON.stringify([...routes].sort());
}

/** Derive a plugin's admin slug from its name (matches the server's derivation). */
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
      const slug = toSlug(plugin.name);
      if (plugin.pages && plugin.pages.length > 0) {
        registerPluginPages(
          slug,
          plugin.pages.map(page => ({
            path: page.path,
            component: page.component,
            requiredPermission: page.requiredPermission,
          }))
        );
        for (const page of plugin.pages) {
          componentPaths.push(page.component);
          // Key on the resolved route (the registry strips leading slashes, so
          // "/reports" and "reports" are one route) and encode the tuple as
          // JSON, since component and permission values can themselves contain
          // the delimiter — `posts:read` style permissions being the common
          // case — which a flat join would render ambiguous.
          registeredRoutes.push(
            JSON.stringify([
              pluginPagePath(slug, page.path),
              page.component,
              page.requiredPermission ?? "",
            ])
          );
        }
      }
      if (plugin.settings?.component) {
        componentPaths.push(plugin.settings.component);
      }
      // Header-slot module must be imported so its components register, even
      // for plugins with no collections/pages/settings.
      const slotPath = plugin.header?.slot ?? plugin.headerSlot;
      if (slotPath) componentPaths.push(slotPath);
      // Schema-builder slot + custom field-type editors are delivered via
      // branding (not collection admin.components), so import their modules here
      // too — otherwise `PluginSlot` can't resolve them on the builder/entry
      // pages until some collection happens to reference the same module.
      if (plugin.schemaBuilderSlot)
        componentPaths.push(plugin.schemaBuilderSlot);
      for (const ft of plugin.fieldTypes ?? []) {
        componentPaths.push(ft.component);
      }
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
