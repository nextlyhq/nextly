import { useEffect } from "react";

import { autoRegisterPluginComponents } from "@admin/lib/plugins/component-registry";
import {
  registerPluginPages,
  clearPluginPages,
} from "@admin/lib/plugins/plugin-route-registry";
import type { PluginMetadata } from "@admin/types/branding";

/** Derive a plugin's admin slug from its name (matches the server's derivation). */
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Registers plugin-contributed admin pages (D21) into the client route registry
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
  useEffect(() => {
    clearPluginPages();
    if (!plugins || plugins.length === 0) return;

    const componentPaths: string[] = [];
    for (const plugin of plugins) {
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
        for (const page of plugin.pages) componentPaths.push(page.component);
      }
      if (plugin.settings?.component) {
        componentPaths.push(plugin.settings.component);
      }
      // Header-slot module must be imported so its components register, even
      // for plugins with no collections/pages/settings.
      const slotPath = plugin.header?.slot ?? plugin.headerSlot;
      if (slotPath) componentPaths.push(slotPath);
    }

    if (componentPaths.length > 0) {
      void autoRegisterPluginComponents(componentPaths);
    }
  }, [plugins]);
}
