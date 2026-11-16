/**
 * The site's resized image copies, for the route that renders its pages.
 *
 * A page's Image block asks for the copies no wider than twice where it is
 * drawn; this answers through the plugin SDK's media interface, which core
 * media offers every plugin, so the page builder holds no knowledge of where
 * copies are kept or how they are made. Bound to one page builder's
 * definition, never to a registry another site's boot can replace, as
 * `namedQueriesOf` is.
 *
 * @module plugin-definition/image-copies
 */
import type { ImageCopies, ImageCopy } from "@nextlyhq/blocks-react";
import {
  MEDIA_COPY_WIDTHS,
  type PluginDefinition,
  type PluginMediaService,
} from "@nextlyhq/plugin-sdk";

/** What this reads of a site's media: one copy at a time. */
type CopyingMedia = Pick<PluginMediaService, "copyOf">;

/** Each page builder's site media, held once its plugin has started. */
const sitesMedia = new WeakMap<PluginDefinition, CopyingMedia>();

/** Hold the site's media for `plugin`, from its `init`. */
export function holdSiteMedia(
  plugin: PluginDefinition,
  media: CopyingMedia
): void {
  sitesMedia.set(plugin, media);
}

/**
 * The route option that sizes a page's images: `imageCopies` on a
 * `createBlocksPage` config, answered by this page builder's site media.
 *
 * Copies come only at the widths the site keeps. They are asked for
 * narrowest first, and the first width no copy can be had at ends the list,
 * since a wider one cannot be had either: past the original's own width, an
 * address on another host, or a storage that cannot make copies. A failure is
 * no copies, so the page draws the original. None before the site has
 * started.
 *
 * @experimental
 */
export function pageBuilderImageCopies(plugin: PluginDefinition): ImageCopies {
  return async (source, upTo) => {
    const media = sitesMedia.get(plugin);
    if (media === undefined) return [];
    const copies: ImageCopy[] = [];
    for (const width of MEDIA_COPY_WIDTHS) {
      if (width > upTo) break;
      const copy = await media.copyOf(source, width).catch(() => null);
      if (copy === null) break;
      if (copies.at(-1)?.width !== copy.width) {
        copies.push({ url: copy.url, width: copy.width });
      }
    }
    return copies;
  };
}
