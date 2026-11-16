import type { AdminCapabilities } from "@admin/types/permissions";

/**
 * The standalone plugins the reader may see in the rail.
 *
 * A plugin naming collections is shown where the reader may read one of them,
 * as the server's answer about those collections decides: the same answer
 * their navigation and routes follow, so the rail never offers a section whose
 * every collection is refused, or hides one the answer allows. A plugin naming
 * none is a settings surface, shown with the settings.
 *
 * @module components/layout/sidebar/lib/standalone-plugins-visible-to
 */
export function standalonePluginsVisibleTo<
  P extends { collections?: readonly string[] },
>(
  plugins: readonly P[],
  capabilities: Pick<AdminCapabilities, "collections" | "canViewSettings">
): P[] {
  return plugins.filter(plugin => {
    const named = plugin.collections ?? [];
    if (named.length === 0) return capabilities.canViewSettings;
    return named.some(slug => capabilities.collections[slug]?.canRead === true);
  });
}
