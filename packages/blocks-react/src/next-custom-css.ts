/**
 * A route's custom CSS: the host's checker, and the site's own CSS read once
 * per render, joined to the page's compile context.
 *
 * Author-written CSS is drawn only where a host vouches for it: the compile
 * draws none without a checker, so a route that names no `customCss` source
 * draws none either, and a site gains it by adding the source its page builder
 * provides. The site's CSS is stored data, so it is read per render rather
 * than captured with the route's configuration; a public route caches that
 * read, tagged with the Singles and the other cache tags the source names, as
 * it caches the site's styles.
 *
 * @module next-custom-css
 */
import { hashId, type StyleCompileContext } from "@nextlyhq/blocks-engine";
import {
  cachedFind,
  nextlySingleTags,
  releaseBoundedRevalidate,
} from "nextly/runtime";

import type { BlocksPageConfig, CustomCssSource } from "./next-page-config";

/**
 * The compile context a route's pages are drawn with: its own, with the
 * custom CSS checker and the site's CSS when it names a source. `undefined`
 * where the route states no context, which compiles nothing to draw CSS into.
 */
export async function routeStyleContext(
  config: Pick<
    BlocksPageConfig,
    "styleContext" | "customCss" | "collections" | "field" | "cacheScope"
  >,
  isPublic: boolean,
  window: number | false | undefined
): Promise<StyleCompileContext | undefined> {
  const { styleContext, customCss } = config;
  if (styleContext === undefined || customCss === undefined) {
    return styleContext;
  }
  const site = await siteCssOf(config, customCss, isPublic, window);
  return {
    ...styleContext,
    customCss: {
      id: customCss.id,
      accepts: (css, level) => customCss.accepts(css, level),
      ...(site === undefined ? {} : { site }),
    },
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
      // The Singles' tags and any others the source names: a write to
      // either is what changes the CSS.
      tags: [
        ...source.singles.flatMap(slug => nextlySingleTags(slug)),
        ...(source.tags ?? []),
      ],
      // Named as the site styles' read is: by the route, the Singles the
      // source declares and the source text of its read.
      keyParts: [
        "nextly-public-custom-css",
        config.cacheScope ?? "",
        JSON.stringify([config.collections, config.field]),
        JSON.stringify([...source.singles].sort()),
        JSON.stringify([...(source.tags ?? [])].sort()),
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
