/**
 * The site's resized image copies, for the route that renders its pages.
 *
 * A page's Image block asks for the copies no wider than twice where it is
 * drawn; this answers through core media's own `copyOf`, so the page builder
 * holds no knowledge of where copies are kept or how they are made.
 *
 * Asked through the site reader the route already holds, the one its
 * `media.findByID` resolves images through, rather than through state the
 * plugin keeps from its `init`. A production Next.js build bundles the plugin
 * into each route, so the route's copy of the page builder is not always the
 * one the site started; the reader reaches the started site from any of them,
 * and two sites served from one process each ask their own.
 *
 * @module plugin-definition/image-copies
 */
import type { ImageCopies, ImageCopy } from "@nextlyhq/blocks-react";
import { MEDIA_COPY_WIDTHS } from "@nextlyhq/plugin-sdk";

/** What a copy is asked for by: an image's id or its address, and a width. */
export type ImageCopyRequest = { width: number } & (
  | { id: string; url?: never }
  | { url: string; id?: never }
);

/**
 * What this reads of a site: its media's copies, as the site's Direct API
 * answers them (`nextly.media.copyOf`).
 *
 * @experimental
 */
export interface ImageCopySite {
  readonly media: {
    copyOf(
      args: ImageCopyRequest
    ): Promise<{ url: string; width: number } | null>;
  };
}

/**
 * The route option that sizes a page's images: `imageCopies` on a
 * `createBlocksPage` config, answered by the site the reader reads.
 *
 * Copies come only at the widths the site keeps. They are asked for
 * narrowest first, and the first width no copy can be had at ends the list,
 * since a wider one cannot be had either: past the original's own width, an
 * address on another host, or a storage that cannot make copies. A failure is
 * no copies, so the page draws the original.
 *
 * @experimental
 */
export function pageBuilderImageCopies(site: ImageCopySite): ImageCopies {
  return async (source, upTo) => {
    const copies: ImageCopy[] = [];
    for (const width of MEDIA_COPY_WIDTHS) {
      if (width > upTo) break;
      const asked: ImageCopyRequest =
        "id" in source ? { id: source.id, width } : { url: source.url, width };
      const copy = await site.media.copyOf(asked).catch(() => null);
      if (copy === null) break;
      if (copies.at(-1)?.width !== copy.width) {
        copies.push({ url: copy.url, width: copy.width });
      }
    }
    return copies;
  };
}
