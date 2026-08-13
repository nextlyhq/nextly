import type { PluginMetadata } from "@admin/types/branding";

import {
  resolvePluginIconFrom,
  type PluginIconSource,
} from "../resolve-plugin-icon";

import type { RegistryPlugin } from "./types";

/**
 * How a catalogue entry is presented, given whether the plugin is installed.
 *
 * The catalogue and the installed plugin both carry an icon and a description,
 * and they can disagree — the catalogue is a curated claim maintained here,
 * the plugin's own metadata is what it declares about itself. Where both
 * exist they describe the same package, so a user comparing the browse card
 * with the installed list would see one plugin wearing two faces.
 *
 * The plugin wins. It is the authority on how it presents itself, it ships
 * with the version actually running, and the catalogue's copy cannot be
 * updated by the plugin author at all.
 *
 * The catalogue is not therefore redundant: it is the ONLY answer for a plugin
 * that is not installed, which is most of what a browse page shows. Deriving
 * these from the plugin packages instead was considered and does not work —
 * the catalogue describes packages this app has not loaded and may not depend
 * on, so reading their metadata would mean `@nextlyhq/admin` importing every
 * plugin it can list, which defeats a catalogue meant to grow beyond
 * first-party plugins.
 *
 * @module lib/plugins/registry/resolve-catalogue-presentation
 */

/**
 * The catalogue's icon in the shape a plugin declares one, so a single chain
 * resolves both sources.
 */
function catalogueAppearance(
  entry: RegistryPlugin
): Pick<PluginMetadata, "appearance"> {
  return {
    appearance: { icon: entry.icon.lucide, iconAsset: entry.icon.asset },
  };
}

/**
 * The appearance sources for a catalogue entry, in precedence order.
 *
 * Exported so a component rendering the icon takes the ordering from here
 * instead of writing `[installed, entry]` itself. That second spelling would be
 * a second answer to which source wins, and the two would agree until one of
 * them gained a step.
 */
export function cataloguePresentationCandidates(
  entry: RegistryPlugin,
  installed: Pick<PluginMetadata, "appearance"> | undefined
): readonly (Pick<PluginMetadata, "appearance"> | undefined)[] {
  return [installed, catalogueAppearance(entry)];
}

export interface CataloguePresentation {
  icon: PluginIconSource;
  description: string;
  /** Whether an installed plugin supplied any of the above. */
  isInstalled: boolean;
}

/**
 * Resolve what to render for a catalogue entry.
 *
 * `installed` is the matching `PluginMetadata`, or `undefined` when the plugin
 * is not installed. Precedence is per field rather than whole-record: an
 * installed plugin that declares no icon still contributes its description,
 * and falls back to the catalogue only for the field it left empty. A
 * whole-record choice would drop a description the plugin does declare purely
 * because it declares no icon.
 */
export function resolveCataloguePresentation(
  entry: RegistryPlugin,
  installed: Pick<PluginMetadata, "appearance" | "description"> | undefined,
  opts: { allowAsset?: boolean } = {}
): CataloguePresentation {
  return {
    icon: resolvePluginIconFrom(
      cataloguePresentationCandidates(entry, installed),
      {
        // Unreachable in practice: `catalogueAppearance` always carries a lucide
        // name, since `RegistryPlugin.icon.lucide` is required. Named rather
        // than asserted so the chain has a total answer if that ever loosens.
        fallback: entry.icon.lucide,
        allowAsset: opts.allowAsset,
      }
    ),
    // An installed plugin declaring an empty description says nothing, so it
    // does not get to blank the catalogue's text.
    description: installed?.description?.trim()
      ? installed.description
      : entry.description,
    isInstalled: installed !== undefined,
  };
}
