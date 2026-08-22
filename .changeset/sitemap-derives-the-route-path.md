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
slash all resolve to somewhere the route answers `notFound()` for, and a reserved path is excluded
by the same check rather than by a second copy of the denylist here.

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
