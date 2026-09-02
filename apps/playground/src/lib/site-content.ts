/**
 * Shared wiring for the playground's public block routes.
 *
 * Two routes draw block documents — the code-first `/blocks` collection and the
 * page builder's `pages` — and both need the same two things: a reader that can
 * resolve entries and media, and the set of breakpoints this site styles
 * against.
 *
 * They live here rather than in each route because a second answer to "what are
 * this site's breakpoints" is how a page's own sheet and the shared site sheet
 * come to emit the same tier under different at-rules. Each sheet stays
 * internally consistent, so the disagreement never surfaces as an error — only
 * as a layout that is wrong at one width.
 *
 * @module lib/site-content
 */
import { loadSiteStyle, SITE_STYLE_SLUG } from "@nextlyhq/plugin-page-builder";
import { getNextly } from "nextly";
import type { NextlyContentReader, NextlySingleReader } from "nextly/runtime";

import nextlyConfig from "../../nextly.config";

import { SITE_STYLE_DEFAULTS } from "./site-style-defaults";

type NextlyInstance = Awaited<ReturnType<typeof getNextly>>;

/**
 * The instance, resolved per call.
 *
 * A route helper otherwise falls back to the synchronous `getNextly()` from
 * `nextly/runtime`, which returns the already-registered singleton and throws
 * when nothing has registered it. A public page can be the FIRST request a cold
 * server handles, so relying on that means the route works only once something
 * else has booted the CMS — in this app, a visit to `/admin`.
 *
 * Async boot cannot happen where the config is captured (module scope), so this
 * is a function rather than a value. `getNextly` caches, so every call after the
 * first is a lookup.
 */
const instance = () => getNextly({ config: nextlyConfig });

/**
 * Just the media lookup the route helpers probe for.
 *
 * Narrower than the instance's whole `media` namespace on purpose: this reader
 * exists to be READ from, and forwarding `upload`/`update`/`delete` would offer
 * a public page route a write surface it has no reason to hold.
 */
type MediaLookup = Pick<NextlyInstance["media"], "findByID">;

/**
 * The reader every public content route on this site resolves through.
 *
 * The media namespace is forwarded rather than dropped. Ordinary Nextly media
 * lives in a SYSTEM table with its own namespace, and the block route resolves
 * an image's `mediaId` through `reader.media.findByID`. A wrapper exposing only
 * `find` and `findByID` satisfies `NextlyContentReader` and silently loses that
 * lookup, so every `core/image` storing a media id — rather than a literal
 * `src` — resolves to null and draws nothing.
 */
export const siteReader: NextlyContentReader &
  NextlySingleReader & { media: MediaLookup } = {
  find: async args => (await instance()).find(args),
  findByID: async args => (await instance()).findByID(args),
  // A Single page reads the document itself through `findSingle` and its BLOCKS
  // through `find`/`findByID`. One reader carrying both is what keeps a page and
  // everything embedded in it coming from a single instance — which on a
  // per-tenant setup is a single database.
  findSingle: async args => (await instance()).findSingle(args),
  media: {
    findByID: async args => (await instance()).media.findByID(args),
  },
};

/**
 * The site's breakpoints, and the reason a route compiles its own sheet.
 *
 * `PageRenderer` emits class NAMES unconditionally and CSS only when it is given
 * either a stored `styles` artifact or a `styleContext` to compile from. Neither
 * of this app's block routes stores a compiled sheet, so without a context every
 * authored node style and every `visibility.devices` rule would resolve to a
 * class that no rule ever defines, and the page would render structurally
 * correct and visually bare.
 *
 * DERIVED from `SITE_STYLE_DEFAULTS` rather than declared beside it, because a
 * second statement of the breakpoints is how the page sheet and the shared
 * site sheet come to emit the same tier under different at-rules — each side
 * internally consistent, so nothing errors.
 *
 * Left unannotated deliberately. `StyleCompileContext` is what the route helpers
 * accept, and `@nextlyhq/blocks-react` does not re-export it — naming the type
 * here would mean taking a direct dependency on `@nextlyhq/blocks-engine` purely
 * to label a config object. The shape is still fully checked where it is passed.
 */
export const SITE_STYLE_CONTEXT = {
  breakpoints: SITE_STYLE_DEFAULTS.breakpoints,
};

/**
 * The site sheet's inputs, resolved PER REQUEST — the code-stated defaults with
 * the stored Site Style document layered on top, so a token or class an admin
 * saves reaches the next page view rather than the next deploy.
 *
 * ONE provider, because the routes had drifted. The collection route built this
 * inline while `/` and `/landing` passed only {@link SITE_STYLE_CONTEXT}, which
 * carries the breakpoints and NO token set — so those two synthesised a sheet
 * without the site's tokens and fell back to the engine's default
 * `[data-nx-theme="dark"]` selector. This app has no theme toggle and darkens
 * through `prefers-color-scheme`, so every dark token value silently never
 * applied on the two routes a visitor is most likely to land on.
 *
 * A shared export rather than three call sites agreeing by inspection: the
 * failure had no symptom, because a route that omits this renders perfectly and
 * merely resolves its tokens differently from the route beside it.
 */
export const SITE_STYLES = {
  read: () =>
    loadSiteStyle({ nextly: siteReader, defaults: SITE_STYLE_DEFAULTS }),
  /**
   * What that read depends on. A cacheable route caches the whole render and
   * only a tag it carries rebuilds it, and the Direct API read inside `read`
   * contributes none — so without naming the single, an admin's save would
   * invalidate a tag no cache entry holds and the page would keep serving the
   * old sheet.
   */
  singles: [SITE_STYLE_SLUG],
};

/**
 * The metadata a Single-backed page derives from its document.
 *
 * Shared by the two single-page routes, which had the same nine lines each. The
 * SEO derivation wins over the stored field where it has an answer, because it
 * reads the page's own first heading and opening paragraph — a title an author
 * changed in the layout should not be contradicted by a `title` field they
 * forgot.
 *
 * Not shared with the collection route, whose version also states `canonical`:
 * an entry has a path within its collection and a Single does not.
 */
export function singleMetadata(
  document: Record<string, unknown>,
  _context: unknown,
  derived: {
    title?: string | undefined;
    description?: string | undefined;
    image?: string | undefined;
  }
): {
  title: string | undefined;
  description: string | undefined;
  openGraph?: { images: { url: string }[] };
} {
  return {
    title: derived.title ?? (document.title as string | undefined),
    description: derived.description,
    ...(derived.image
      ? { openGraph: { images: [{ url: derived.image }] } }
      : {}),
  };
}
