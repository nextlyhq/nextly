---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
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
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

Compare any two versions of a document in the admin history panel.

From a version's preview in the history panel, you can now compare it against the previous version or the current one. The comparison lays out what changed field by field: edited text reads inline with the added and removed words highlighted, changed values show their before and after, and list items and relationships are marked as added, removed, moved, or edited. A "Changed only" toggle, on by default, hides everything that stayed the same so the real differences stand out.

Available for both collection entries and singles on any document with versioning enabled. A comparison is always between two versions in the same locale.
