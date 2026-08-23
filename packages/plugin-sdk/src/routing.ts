/**
 * `@nextlyhq/plugin-sdk/routing` — the content route's own answer to where a
 * stored slug renders.
 *
 * ## Why this is a subpath rather than part of the root
 *
 * `export … from "nextly/runtime"` is a STATIC ESM edge, so putting it on the
 * root would make every consumer of `@nextlyhq/plugin-sdk` instantiate that
 * barrel — including one importing nothing but `definePlugin`. Measured from the
 * built artifact, `nextly/runtime` transitively reaches 124 modules and about
 * 3.9 MB, and pulls `fs`, `async_hooks`, `crypto`, `path` and `util` with it.
 * That is Next request-lifecycle and server Direct API code, so a browser or
 * isomorphic consumer can fail to bundle and every server plugin inherits a
 * graph it never asked for.
 *
 * A subpath makes the cost opt-in: it is paid by a plugin that wants routing and
 * by nobody else. The same reasoning already separates `/blocks`, so that a
 * plugin unrelated to blocks never pulls the engine into its type graph.
 *
 * Note what a subpath does NOT do: the helper still arrives through
 * `nextly/runtime`, so a consumer of THIS entry still pays that graph. Making it
 * genuinely cheap means moving the function to a leaf module in core — it
 * depends only on the reserved-path list — which is filed separately.
 *
 * @module routing
 */

/**
 * @experimental Anything a plugin emits a URL FOR an entry with — a sitemap
 *   `<loc>`, a canonical, a link between entries — derives it from this rather
 *   than rebuilding the rule, because a second opinion names a path the route
 *   does not serve. It returns the segments the catch-all matches, or `null`
 *   when the route would refuse the slug: a reserved path, a `.`/`..` segment,
 *   or one whose normalization changed.
 *
 *   Note what it is NOT told: the route's MOUNT. It judges the value Next hands
 *   the route, which excludes the static prefix, so a caller mounting a
 *   collection under `/blog` supplies that prefix itself — and a slug the route
 *   refuses at the root is refused under every mount, because the route decides
 *   on the same mount-less value.
 *
 *   `@nextlyhq/plugin-seo` exercises it for sitemap URLs, which starts the D55
 *   clock rather than ending it.
 */
export { slugToStaticParam } from "nextly/runtime";
