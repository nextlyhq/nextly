/**
 * The site style a published route serves: the package root's
 * `loadSiteStyle`, the stored document layered over the code's defaults.
 *
 * Its own module, apart from `site-style-storage`, because it is the
 * server-only entry the published render loads through; browser entries
 * reach `site-style-storage` directly.
 *
 * The defaults a host hands it are its own config, which names none of the
 * looks its blocks supply (a Section's Hero, an Image's Circle). The canvas
 * adds those to its class library, so this load adds the same set, from the
 * same function, or a block wearing one is drawn styled on the canvas and
 * plain on the page. The host changes nothing.
 *
 * @module site-style-load
 */
import { withRegisteredLooks } from "./core-looks";
import type { SiteStyleData } from "./site-style";
import {
  type loadSiteStyle as loadStoredSiteStyle,
  readStoredSiteStyle,
  resolvedSiteStyleOf,
} from "./site-style-storage";

/**
 * Config defaults, with every registered block's looks, and the stored
 * document layered on top, ready to hand to a route helper's `siteStyles`.
 */
export async function loadSiteStyle(
  args: Parameters<typeof loadStoredSiteStyle>[0]
): Promise<SiteStyleData> {
  // The slug alone, never an access override: this is published, and its
  // read keeps the posture of the reader it was handed.
  const stored = await readStoredSiteStyle({
    nextly: args.nextly,
    ...(args.slug === undefined ? {} : { slug: args.slug }),
  });
  // The looks are taken after the read, not before it: a host's reader may
  // start the site on its first read, and the site's plugins register their
  // blocks as it starts.
  return resolvedSiteStyleOf(stored, withRegisteredLooks(args.defaults));
}
