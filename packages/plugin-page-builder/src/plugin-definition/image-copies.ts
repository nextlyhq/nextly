/**
 * The site's resized image copies, for the route that renders its pages.
 *
 * A page's Image block asks for the copies no wider than twice where it is
 * drawn; this answers through core media's own `copiesOf`, so the page builder
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
import type { ImageCopies } from "@nextlyhq/blocks-react";

/** What copies are asked for by: an image's id or its address, and a width. */
export type ImageCopyRequest = { upTo: number } & (
  | { id: string; url?: never }
  | { url: string; id?: never }
);

/**
 * What this reads of a site: its media's copies, as the site's Direct API
 * answers them (`nextly.media.copiesOf`).
 *
 * @experimental
 */
export interface ImageCopySite {
  readonly media: {
    copiesOf(
      args: ImageCopyRequest
    ): Promise<readonly { url: string; width: number }[]>;
  };
}

/** Why copies were not looked up: the page has no reads left to spend. */
const READS_SPENT =
  "The page has spent its reads, so its images are drawn as they are.";

/**
 * The route option that sizes a page's images: `imageCopies` on a
 * `createBlocksPage` config, answered by the site the reader reads.
 *
 * Every copy the site keeps up to the width asked for, narrowest first, in
 * one lookup, which reads the image once. Each lookup claims one of the
 * page's reads, where the route hands them over, and is refused, not
 * answered with none, once the page has spent them. A lookup that fails is
 * refused too. A route keeps the answers it is given, so a list cut short by
 * either would be kept, and would send softer images until the image changed;
 * refused, the page draws the original and asks again next time.
 *
 * @experimental
 */
export function pageBuilderImageCopies(site: ImageCopySite): ImageCopies {
  return async (source, upTo, reads) => {
    if (reads?.take({ kind: "image" }) === false) {
      throw new Error(READS_SPENT);
    }
    const copies = await site.media.copiesOf(
      "id" in source ? { id: source.id, upTo } : { url: source.url, upTo }
    );
    return copies.map(copy => ({ url: copy.url, width: copy.width }));
  };
}
