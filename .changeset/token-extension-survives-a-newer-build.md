---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/builder": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
"create-nextly-app": patch
"nextly": patch
---

Design-token files keep what a newer build of this system wrote.

The `com.nextlyhq.nextly` extension key is now split rather than consumed. The
fields this build reads — `css`, `kind` and `id` — are taken into the token and
written back from it; anything else found there is kept beside them and written
out again where it was found. Importing a file exported by a newer build and
exporting it again no longer strips what that build recorded, and there is no
longer a warning naming the loss, because there is no loss.

The format requires a tool to preserve extension data it does not understand,
and says nothing about a producer meeting a newer version of itself. A
reverse-domain key names the vendor rather than the build, so the same rule now
covers both.

A stored field never shadows one the model states. The split is applied on the
way out as well as on the way in, so a token saved while a field was unread
cannot state a value the site has since changed.

Two places that decide what happens to a token had to learn about it: the
comparison that decides whether a stored override differs from a site's own
defaults, which would otherwise drop the preserved data on an unrelated edit,
and the export's report of what a file cannot hold, since this data reaches
`JSON.stringify` by the same route as another vendor's.
