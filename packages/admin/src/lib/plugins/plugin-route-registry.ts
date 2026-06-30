/**
 * Client-side registry of plugin-contributed admin pages.
 *
 * Plugin pages are namespaced under `/admin/plugins/<slug>/<path>` to avoid
 * collisions with core routes (mirrors the P4 API namespacing `/api/plugins/
 * <name>`). The registry is consulted by `resolveRoute` (after exact matches,
 * before dynamic matches). Components are resolved client-side via the string-
 * path component registry (`PluginSlot`).
 *
 * Module-level singleton (mirrors `component-registry`), rebuilt from
 * `branding.plugins[].pages` when admin-meta loads.
 *
 * @module lib/plugins/plugin-route-registry
 */

export interface RegisteredPluginPage {
  /** Full namespaced admin path: `/admin/plugins/<slug>/<path>`. */
  fullPath: string;
  /** Component path resolved via the component registry. */
  component: string;
  /** Permission required to view this page (route-level RBAC, D36). */
  requiredPermission?: string;
}

const registry = new Map<string, RegisteredPluginPage>();

/** Build the namespaced admin path for a plugin page. */
export function pluginPagePath(slug: string, path: string): string {
  const clean = path.replace(/^\/+/, "");
  return `/admin/plugins/${slug}/${clean}`;
}

/** Register a single plugin page. */
export function registerPluginPage(args: {
  slug: string;
  path: string;
  component: string;
  requiredPermission?: string;
}): void {
  const fullPath = pluginPagePath(args.slug, args.path);
  registry.set(fullPath, {
    fullPath,
    component: args.component,
    requiredPermission: args.requiredPermission,
  });
}

/** Register all pages for a plugin slug. */
export function registerPluginPages(
  slug: string,
  pages: Array<{ path: string; component: string; requiredPermission?: string }>
): void {
  for (const page of pages) {
    registerPluginPage({ slug, ...page });
  }
}

/** Look up a registered plugin page by full pathname (exact match). */
export function matchPluginPage(
  pathname: string
): RegisteredPluginPage | undefined {
  return registry.get(pathname);
}

/** Clear all registered plugin pages (rebuild on admin-meta change / tests). */
export function clearPluginPages(): void {
  registry.clear();
}

/** All registered plugin pages (debugging/introspection). */
export function getRegisteredPluginPages(): RegisteredPluginPage[] {
  return Array.from(registry.values());
}
