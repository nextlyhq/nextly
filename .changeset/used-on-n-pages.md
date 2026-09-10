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

The page builder can answer "used on N pages" for a component.

`componentUsageCount` reads the usage index through a grouped query and counts
DISTINCT documents. That distinction is the feature rather than an
implementation detail: the index files a row per field, per locale and per
stored variant, so a page using one component in two languages while holding a
pending draft contributes several rows — and a count of rows would report that
page as several, then climb every time somebody added a translation.

The answer carries whether it is complete, and it can be short for two
reasons. A grouped read is capped, so a component used on more pages than the
cap comes back at the cap. And a document too large to walk whole is recorded
as a single marker with its references discarded, so it is missing from every
component's count rather than wrong in one of them — a component embedded only
there would otherwise read as used by nothing at all. Either way
`complete: false` says the number is a floor, and the surface decides how to
say so.

The index is now BACKFILLED, which is what makes the count trustworthy on a
site that existed before it. The write hooks only maintain the index going
forward, so every document that already existed was absent from it — and an
absent document is indistinguishable from a component nothing uses. A sweep job
walks one (collection, field, locale, variant) per tick, recording each as it
finishes, so an interrupted run resumes instead of restarting and a large site
cannot starve the queue. Completion is recomputed against the scopes that exist
NOW rather than latched, so adding a collection, a locale or drafts correctly
returns the count to a floor until the new work is done.

Until that is finished `complete` is false, so the number is never presented as
whole while the population behind it is still being assembled.

`usageCountReader` binds the count to the Direct API. It reads as the system
because the index denies every access rule it declares, and an untrusted read
answers an empty set — indistinguishable from a component nothing uses. It
takes the index collection's slug, so `COMPONENT_USAGE_INDEX_SLUG` is exported
beside it: the plugin resolves that name from its own context, which
application code cannot reach, and without the export the only way to call the
reader would be to spell the collection name as a literal.
