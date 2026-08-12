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
/** A surface that cannot render an image always gets the lucide variant. */
export function resolvePluginIcon(
  meta: Pick<PluginMetadata, "appearance">,
  opts: { fallback: string; allowAsset: false }
): Extract<PluginIconSource, { kind: "lucide" }>;
export function resolvePluginIcon(
  meta: Pick<PluginMetadata, "appearance">,
  opts: { fallback: string; allowAsset?: boolean }
): PluginIconSource;
export function resolvePluginIcon(
  meta: Pick<PluginMetadata, "appearance">,
  opts: {
    fallback: string;
    /**
     * Whether this surface can render an image. The sidebar rail and the
     * plugin section items cannot: they look an icon up by name and render an
     * ElementType, so there is nowhere to put an `<img>`.
     *
     * Passing `false` skips the asset rather than making the caller undo the
     * choice afterwards. That distinction matters: a plugin declaring BOTH an
     * asset and a lucide name is saying "use my logo where you can, this glyph
     * where you cannot", and a caller that resolved the asset and then
     * substituted its own default would throw away the glyph the plugin
     * declared for exactly this case.
     */
    allowAsset?: boolean;
  }
): PluginIconSource {
  const asset = meta.appearance?.iconAsset;
  if (asset && opts.allowAsset !== false) return { kind: "asset", src: asset };

  const name = meta.appearance?.icon;
  if (name) return { kind: "lucide", name };

  return { kind: "lucide", name: opts.fallback };
}
