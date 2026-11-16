/**
 * Which collections' document screens start with the rail's panel folded
 * away, as their plugins declare (`views[slug].foldedPanel`).
 *
 * Two sources, one answer: the admin metadata once it has answered
 * (`branding.plugins[].foldedPanels`), and before that what the prebuilt admin
 * page carries (`adminStartupScreensJson`), written from the same declaration
 * when the page was built. So the frame drawn before any request answers, and
 * the screen drawn after, fold the same screens, and nothing moves between
 * them.
 *
 * @module lib/plugins/folded-panels
 */
import { ADMIN_STARTUP_SCREENS_ELEMENT_ID } from "nextly/config";

import type { PluginMetadata } from "@admin/types/branding";

/**
 * The folded collections the prebuilt page names in `json`, the text of its
 * startup screens element; none where there is no element or it is not of
 * that shape.
 */
export function prebuiltFoldedPanels(json: string | null): readonly string[] {
  if (json === null) return [];
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const folded: unknown = (parsed as { foldedPanels?: unknown }).foldedPanels;
  return Array.isArray(folded)
    ? folded.filter((slug): slug is string => typeof slug === "string")
    : [];
}

/** Read once: the prebuilt page does not change while it is open. */
let fromPage: readonly string[] | undefined;

/** The folded collections this page was built with. */
function pageFoldedPanels(): readonly string[] {
  if (fromPage === undefined) {
    fromPage =
      typeof document === "undefined"
        ? []
        : prebuiltFoldedPanels(
            document.getElementById(ADMIN_STARTUP_SCREENS_ELEMENT_ID)
              ?.textContent ?? null
          );
  }
  return fromPage;
}

/**
 * Whether the collection `slug`'s document screens start folded: by the
 * admin metadata's plugins where they have answered (`plugins` is undefined
 * until then), else by the prebuilt page.
 */
export function collectionFoldsPanel(
  plugins: readonly PluginMetadata[] | undefined,
  slug: string
): boolean {
  if (plugins !== undefined) {
    return plugins.some(plugin => plugin.foldedPanels?.includes(slug));
  }
  return pageFoldedPanels().includes(slug);
}

/**
 * The name the reader's choice to open or fold the panel is remembered under
 * for a collection's document screens: one per collection, so every entry of
 * it opens the way the reader last left one.
 */
export function collectionFoldKey(slug: string): string {
  return `collections/${slug}`;
}
