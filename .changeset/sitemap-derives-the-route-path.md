---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

The sitemap now derives each entry's path from `slugToStaticParam` — the route's own answer to
where a stored slug renders — instead of building one alongside it. A sitemap listing a URL the
route does not serve costs indexing, and the two derivations had drifted in four ways.

A nested slug keeps its separators. `docs/getting-started` is a path the catch-all route serves as
two segments; encoding the slug whole produced `docs%2Fgetting-started`, a single segment naming
nothing. A slug the route refuses is now skipped rather than advertised: `..`, `a//b` and a leading
slash all resolve to somewhere the route answers `notFound()` for.

The reserved-path denylist is asked about the STORED SLUG, which is the value the route itself
checks — it joins its catch-all params, and those exclude the mount prefix. A page stored as `admin`
therefore reaches `notFound()` under every mount, so it stays out of the sitemap under every mount
too. Judging the final URL instead would list `/pages/admin` as unreserved and advertise a dead
link. The module keeps no second copy of the denylist either way.

`buildSitemapUrls` and `generateSitemap` gain `basePath`, which declares where a collection's route
is MOUNTED — the one part of an entry's URL that cannot be derived, because it is decided by where
the route file sits in the app directory. It defaults to `/<collection>`, so an existing sitemap is
unchanged for simple slugs. Pass `""` for a collection served at the site root: a page builder's
pages render at `/about` rather than `/pages/about`, which no previous option could express. A
function receives each collection name and may return `null` to exclude
that collection entirely, and it is resolved before the collection is read so an excluded one costs
no queries. `basePath` is ignored when a custom `urlFor` is supplied, which already owns the whole
path.

`basePath` must be a plain path prefix. One carrying a query or fragment is refused rather than
passed through, because `/docs?lang=en` reaches URL resolution as a query and would advertise every
entry at a location the route never serves — a misconfiguration is better as an error than as a
sitemap of subtly wrong URLs.

`@nextlyhq/plugin-sdk` gains `slugToStaticParam` as an `@experimental` export, and the sitemap takes
it from there rather than reaching into `nextly/runtime`. The SDK is the stability boundary, and a
first-party plugin is the worked example third parties copy, so importing core directly would have
published the shortcut as the pattern. It costs nothing at the boundary: `nextly` is declared
external in the SDK's build, so the entry grows by one re-export line and the route's module graph
stays in the consumer's own `nextly` install.

An empty slug is now skipped under every mount, declared or not. Whether a mount's own root is
served depends on the route file — a required `[...slug]` catch-all matches no segments and 404s
there, an optional `[[...slug]]` serves it — and `basePath` names the prefix, not that. Both shapes
exist in this repository, so declaring a mount is not a claim that its root is routable, and a site
that does serve its root maps it with `urlFor`. Omitting a URL costs a listing; advertising one that
404s costs indexing.

`basePath` also rejects `.` and `..` segments, including their percent-encoded spellings, and a
backslash: a dot segment is removed by URL resolution before the request is sent, so
`/docs/../admin` would mount at `/admin` and carry every entry under it somewhere the caller
never named, and `\` separates segments to the URL parser on an http(s) origin, which would
walk the same escape past a check that splits only on `/`. Repeated slashes are COLLAPSED
rather than refused, because `//docs` has one possible meaning and left alone it is read as
protocol-relative — `//docs/a` resolves to host `docs`, off-origin, and the whole collection
drops out of the sitemap with nothing said.

Control characters are refused for the same reason a query is: URL parsing DELETES a tab, carriage
return or newline rather than encoding it, so `/docs` plus a newline plus `admin` reaches the origin
as `/docsadmin` — a mount nobody wrote. The whole C0 range is refused rather than those three
spellings, since none of them belongs in a path prefix.

The plugin's declared core-compat floor rises from `>=0.0.2-alpha.21` to `>=0.0.2-alpha.55`, the
first core that exports `slugToStaticParam`. On an earlier core the new import fails at module load
before the plugin can initialise, so the wider range advertised a compatibility that could not
resolve.
