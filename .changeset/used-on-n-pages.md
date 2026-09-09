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

The answer carries whether it is complete. A grouped read is capped, so a
component used on more pages than the cap comes back short and
complete-looking, which is the reading that tells an author a widely used
component is barely used. `complete: false` says the number is a floor, and the
surface decides how to say so.

`usageCountReader` binds the count to the Direct API. It reads as the system
because the index denies every access rule it declares, and an untrusted read
answers an empty set — indistinguishable from a component nothing uses.
