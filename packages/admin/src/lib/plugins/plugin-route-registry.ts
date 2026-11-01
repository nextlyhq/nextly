/**
 * Client-side registry of plugin-contributed admin pages.
 *
 * Plugin pages are namespaced under `/admin/plugins/<slug>/<path>` to avoid
 * collisions with core routes (mirrors the P4 API namespacing, `/plugins/
 * <name>` beneath the handler's mount). The registry is consulted by
 * `resolveRoute` (after exact matches,
 * before dynamic matches). Components are resolved client-side via the string-
 * path component registry (`PluginSlot`).
 *
 * Module-level singleton (mirrors `component-registry`), rebuilt from
 * `branding.plugins[].pages` when admin-meta loads.
 *
 * @module lib/plugins/plugin-route-registry
 */

import type { ActiveNavSection } from "@admin/constants/nav-sections";

export interface RegisteredPluginPage {
  /** Full namespaced admin path: `/admin/plugins/<slug>/<path>`. */
  fullPath: string;
  /** Component path resolved via the component registry. */
  component: string;
  /** Permission required to view this page (route-level RBAC, D36). */
  requiredPermission?: string;
  /**
   * The rail section to select while this page is open, as declared by the
   * contributing plugin. Absent means the plugin expressed no preference and
   * the page belongs under Plugins.
   */
  section?: ActiveNavSection;
}

const registry = new Map<string, RegisteredPluginPage>();

/** Build the namespaced admin path for a plugin page. */
/** Where every plugin page's address starts, ahead of its slug. */
const PLUGIN_PAGE_PREFIX = "/admin/plugins/";

export function pluginPagePath(slug: string, path: string): string {
  const clean = path.replace(/^\/+/, "");
  return `${PLUGIN_PAGE_PREFIX}${slug}/${clean}`;
}

/**
 * Whether `pathname` has a plugin page's shape, `/admin/plugins/<slug>/<path>`:
 * a slug and at least one segment after it. A plugin's own detail address,
 * `/admin/plugins/<slug>`, is a core route and is not.
 */
export function isPluginPageAddress(pathname: string): boolean {
  if (!pathname.startsWith(PLUGIN_PAGE_PREFIX)) return false;
  const [slug, ...rest] = pathname.slice(PLUGIN_PAGE_PREFIX.length).split("/");
  return Boolean(slug) && rest.some(Boolean);
}

/** Register a single plugin page. */
export function registerPluginPage(args: {
  slug: string;
  path: string;
  component: string;
  requiredPermission?: string;
  section?: ActiveNavSection;
}): void {
  const fullPath = pluginPagePath(args.slug, args.path);
  registry.set(fullPath, {
    fullPath,
    component: args.component,
    requiredPermission: args.requiredPermission,
    section: args.section,
  });
}

/** Register all pages for a plugin slug. */
export function registerPluginPages(
  slug: string,
  pages: Array<{
    path: string;
    component: string;
    requiredPermission?: string;
    section?: ActiveNavSection;
  }>
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

/**
 * Whether the registry has been filled from an admin-meta answer at least once.
 *
 * Until then an address under the plugin prefix that matches nothing may yet
 * be a plugin page, so it is held rather than answered as not found. Kept
 * apart from the pages themselves: each answer clears and refills them, and
 * the registry stays known throughout.
 */
let known = false;

/** Records whether the registry has been filled from admin-meta. */
export function setPluginPagesKnown(value: boolean): void {
  known = value;
}

/** Whether the registry has been filled from admin-meta at least once. */
export function arePluginPagesKnown(): boolean {
  return known;
}

/** Clear all registered plugin pages (rebuild on admin-meta change / tests). */
export function clearPluginPages(): void {
  registry.clear();
}

/** All registered plugin pages (debugging/introspection). */
export function getRegisteredPluginPages(): RegisteredPluginPage[] {
  return Array.from(registry.values());
}
