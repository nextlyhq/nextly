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
import { getNextly } from "nextly";
import type { NextlyContentReader } from "nextly/runtime";

import nextlyConfig from "../../nextly.config";

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
export const siteReader: NextlyContentReader & { media: MediaLookup } = {
  find: async args => (await instance()).find(args),
  findByID: async args => (await instance()).findByID(args),
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
 * Declared by the host because breakpoints are a site decision: the engine never
 * reads storage and ships no default set. Ids must be unique across both axes,
 * and the base breakpoint carries no `maxWidth` — it is the fallback the others
 * narrow.
 *
 * Left unannotated deliberately. `StyleCompileContext` is what the route helpers
 * accept, and `@nextlyhq/blocks-react` does not re-export it — naming the type
 * here would mean taking a direct dependency on `@nextlyhq/blocks-engine` purely
 * to label a config object. The shape is still fully checked where it is passed.
 */
export const SITE_STYLE_CONTEXT = {
  breakpoints: {
    viewport: [
      { id: "base", label: "Base" },
      { id: "tablet", label: "Tablet", maxWidth: 1024 },
      { id: "mobile", label: "Mobile", maxWidth: 640 },
    ],
    container: [],
  },
};
