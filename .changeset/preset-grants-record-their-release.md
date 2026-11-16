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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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

`nextly migrate` now records the Nextly release that set the preset roles' grants (Admin, Editor, Author, Viewer), keeping the newest, and writes that record in one transaction with every preset role's grants, so a run that stops part-way leaves all of them and the record as they were. A `nextly migrate` from a release older than the recorded one adds and removes no preset grant and says which release set them; the rest of its run is unchanged. This covers releases from this one on: moving a site to an older release that carries it leaves the preset grants as the newest release set them, while a release from before it reads no record and sets the grants to its own presets. A preset role that cannot be created or set now leaves every preset role's grants unchanged, with a warning, rather than setting the others. Starts still set the preset grants as before and neither read nor write the record.
