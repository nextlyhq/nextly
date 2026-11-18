/**
 * A route's custom CSS: the host's checker, and the site's own CSS read once
 * per render, joined to the page's compile context.
 *
 * Author-written CSS is drawn only where a host vouches for it: the compile
 * draws none without a checker, so a route that names no `customCss` source
 * draws none either, and a site gains it by adding the source its page builder
 * provides. The site's CSS is stored data, so it is read per render rather
 * than captured with the route's configuration; a public route caches that
 * read, tagged with the Singles the source names, as it caches the site's
 * styles.
 *
 * @module next-custom-css
 */
import { hashId, type CustomCssPolicy } from "@nextlyhq/blocks-engine";
import {
  cachedFind,
  nextlySingleTags,
  releaseBoundedRevalidate,
} from "nextly/runtime";

import type { BlocksPageConfig, CustomCssSource } from "./next-page-config";

/**
 * The custom CSS checker a route's pages are drawn with, with the site's CSS
 * read for this render, or `undefined` when the route names no source. Handed
 * to the renderer on its own rather than joined to the route's context, so it
 * reaches whichever context the page compiles with: the route's, or the one
 * the site's styles supply.
 */
export async function routeCustomCss(
  config: Pick<
    BlocksPageConfig,
    "customCss" | "collections" | "field" | "cacheScope"
  >,
  isPublic: boolean,
  window: number | false | undefined
): Promise<CustomCssPolicy | undefined> {
  const { customCss } = config;
  if (customCss === undefined) return undefined;
  const site = await siteCssOf(config, customCss, isPublic, window);
  return {
    id: customCss.id,
    accepts: (css, level) => customCss.accepts(css, level),
    ...(site === undefined ? {} : { site }),
  };
}

/** The site's CSS for this render: cached on a public route, fresh otherwise. */
async function siteCssOf(
  config: Pick<BlocksPageConfig, "collections" | "field" | "cacheScope">,
  source: CustomCssSource,
  isPublic: boolean,
  window: number | false | undefined
): Promise<string | undefined> {
  if (!isPublic) return written(await source.readSite());
  // `null` stands for "none" inside the cache, which keeps values as JSON.
  const read = await cachedFind(
    async () => written(await source.readSite()) ?? null,
    {
      tags: source.singles.flatMap(slug => nextlySingleTags(slug)),
      // Named as the site styles' read is: by the route, the Singles the
      // source declares and the source text of its read.
      keyParts: [
        "nextly-public-custom-css",
        config.cacheScope ?? "",
        JSON.stringify([config.collections, config.field]),
        JSON.stringify([...source.singles].sort()),
        hashId(String(source.readSite)),
      ],
      revalidate: await releaseBoundedRevalidate(window),
    }
  );
  return read ?? undefined;
}

/** Stored CSS with something in it, or `undefined`. */
function written(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}
