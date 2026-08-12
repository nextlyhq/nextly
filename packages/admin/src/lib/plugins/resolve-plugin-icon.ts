import type { PluginMetadata } from "@admin/types/branding";

/**
 * What a caller should render for a plugin: an image the plugin ships, or a
 * lucide icon named by its string.
 */
export type PluginIconSource =
  | { kind: "asset"; src: string }
  | { kind: "lucide"; name: string };

/**
 * Resolve which icon represents a plugin.
 *
 * The CHAIN is shared; the final fallback is not, and that split is
 * deliberate. Four call sites resolved this independently and two of them
 * disagreed on the default, which is the drift this fixes. But the
 * disagreement was partly legitimate: the sidebar represents a standalone
 * plugin by the collections it registers, where `Database` reads correctly,
 * while the plugins table and detail page represent it as a package, where
 * `Package` does. Unifying the default would silently change the sidebar.
 *
 * So the ordering lives here and the context-appropriate default stays with
 * the caller that knows its own context.
 *
 * @module lib/plugins/resolve-plugin-icon
 */
export function resolvePluginIcon(
  meta: Pick<PluginMetadata, "appearance">,
  opts: { fallback: string }
): PluginIconSource {
  const asset = meta.appearance?.iconAsset;
  if (asset) return { kind: "asset", src: asset };

  const name = meta.appearance?.icon;
  if (name) return { kind: "lucide", name };

  return { kind: "lucide", name: opts.fallback };
}
