---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

Forms moves into the main sidebar rail.

The form builder now declares standalone placement: Forms gets its own icon right after Media, and clicking it opens a sub-sidebar with Forms and Submissions. "Forms" appears exactly once — the duplicate entries in the Plugins section and the Collections group are gone, and the redundant second builder that rendered at the plugin "settings" URL is removed (the Forms collection's edit view is the one and only builder). Hosts that prefer Forms under the Plugins section can override the placement in one config line.
