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

The reserved-path denylist is asked about the MOUNTED path rather than the slug alone, because it is
anchored at the site root. A page called `admin` under a `/pages` mount is served at `/pages/admin`
and belongs in the sitemap; only a collection mounted at the root can collide with `/admin`, `/api`
or `/sitemap.xml`. The check is re-anchored, not weakened — and the module still keeps no second
copy of the denylist.

`buildSitemapUrls` and `generateSitemap` gain `basePath`, which declares where a collection's route
is MOUNTED — the one part of an entry's URL that cannot be derived, because it is decided by where
the route file sits in the app directory. It defaults to `/<collection>`, so an existing sitemap is
unchanged for simple slugs. Pass `""` for a collection served at the site root: a page builder's
pages render at `/about` rather than `/pages/about`, and their homepage at `/`, which no previous
option could express. A function receives each collection name and may return `null` to exclude
that collection entirely, and it is resolved before the collection is read so an excluded one costs
no queries. `basePath` is ignored when a custom `urlFor` is supplied, which already owns the whole
path.

An empty slug is the mount's own root rather than a missing one, and it is emitted only when
`basePath` is given: whether that root is served depends on the mount, and declaring the mount is
how a caller says it is theirs. With no `basePath` an empty slug is skipped exactly as before.

`basePath` must be a plain path prefix. One carrying a query or fragment is refused rather than
passed through, because `/docs?lang=en` reaches URL resolution as a query and would advertise every
entry at a location the route never serves — a misconfiguration is better as an error than as a
sitemap of subtly wrong URLs.

The plugin's declared core-compat floor rises from `>=0.0.2-alpha.21` to `>=0.0.2-alpha.55`, the
first core that exports `slugToStaticParam`. On an earlier core the new import fails at module load
before the plugin can initialise, so the wider range advertised a compatibility that could not
resolve.
