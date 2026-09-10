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

One reason it is a floor today is worth stating plainly, because it applies to
every site: the write hooks maintain the index going FORWARD, and nothing yet
fills it for documents that already existed. So `complete` is false until a
backfill exists, and a surface shows "at least N" rather than a total. That is
the honest reading — a component with no rows is indistinguishable from one
nothing uses, and the flag exists precisely so that difference is not papered
over. The backfill itself is a separate change.

`usageCountReader` binds the count to the Direct API. It reads as the system
because the index denies every access rule it declares, and an untrusted read
answers an empty set — indistinguishable from a component nothing uses. It
takes the index collection's slug, so `COMPONENT_USAGE_INDEX_SLUG` is exported
beside it: the plugin resolves that name from its own context, which
application code cannot reach, and without the export the only way to call the
reader would be to spell the collection name as a literal.

`readUsageIndexHealth` is exported for the same reason. The count REQUIRES the
health, so publishing one without the other would leave a consumer able to get
a trustworthy answer only by reproducing private queries or hard-coding the
object — which is the confident `complete: true` the flag exists to prevent,
written by hand.
