/**
 * What a published page route needs to draw each page inside its Layout.
 *
 * `@nextlyhq/blocks-react/next` draws the regions but cannot import this
 * plugin to learn where the site's default Layout is kept, so the route takes a
 * provider and this is the plugin's. It reads the default the way every other
 * default-Layout path reads it, through `readLayoutSettings`, and names the
 * Single it read so a change of default reaches the pages that use it.
 *
 * @module page-layouts
 */
import { LAYOUTS_SLUG } from "./collections/layouts";
import { PAGE_BUILDER_SETTINGS_SLUG } from "./default-layout/settings-single";
import {
  readLayoutSettings,
  type DefaultLayoutDirectApi,
} from "./default-layout/store";

/**
 * Options for {@link pageBuilderLayouts}. Every one defaults.
 *
 * @experimental New public surface: its names and shape may change before it
 * is marked stable.
 */
export interface PageBuilderLayoutsOptions {
  /**
   * The instance to read through, for a route that reads through a reader of
   * its own (a per-tenant setup). Defaults to the process's Nextly, resolved
   * per read.
   */
  readonly nextly?: Pick<DefaultLayoutDirectApi, "findSingle">;
  /** The Layouts collection's slug, where the host renamed it. */
  readonly layoutsCollection?: string;
  /** The settings Single's slug, where the host renamed it. */
  readonly settingsSingle?: string;
}

/**
 * The provider a blocks page route takes as `layouts`.
 *
 * Structurally the route's `BlocksLayoutsProvider`, stated here rather than
 * imported so this entry stays free of the renderer's Next-coupled subpath; a
 * route that is handed this is type-checked against the real one.
 *
 * @experimental New public surface: its names and shape may change before it
 * is marked stable.
 */
export interface PageBuilderLayoutsProvider {
  readonly readDefault: () => Promise<string | null>;
  readonly singles: readonly string[];
  readonly collection: string;
}

/**
 * Draw this route's pages inside their Layouts, from the page builder's store.
 *
 * ```ts
 * import { pageBuilderLayouts } from "@nextlyhq/plugin-page-builder";
 *
 * createBlocksPage({
 *   collections: ["pages"],
 *   field: "content",
 *   layouts: pageBuilderLayouts(),
 * });
 * ```
 *
 * The default is read as the system, because a visitor reading a public page
 * has no right to read site settings and must still get the site's header.
 * It reads and never writes: a site whose default is missing is repaired by
 * the plugin's scheduled job, not by a visitor's request.
 *
 * @experimental New public surface: its names and shape may change before it
 * is marked stable.
 */
export function pageBuilderLayouts(
  options: PageBuilderLayoutsOptions = {}
): PageBuilderLayoutsProvider {
  const settings = options.settingsSingle ?? PAGE_BUILDER_SETTINGS_SLUG;
  const layouts = options.layoutsCollection ?? LAYOUTS_SLUG;
  return {
    readDefault: async () => {
      // Resolved per read rather than captured, through the plugin SDK as the
      // plugin's other paths outside a route resolve it: a route module is
      // loaded before Nextly has booted, and `getCachedNextly` waits for the
      // boot that a captured instance would have raced.
      const nextly =
        options.nextly ??
        (await (await import("@nextlyhq/plugin-sdk")).getCachedNextly());
      const { defaultLayout } = await readLayoutSettings(nextly, {
        layouts,
        settings,
      });
      return defaultLayout;
    },
    singles: [settings],
    collection: layouts,
  };
}
