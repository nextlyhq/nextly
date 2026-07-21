---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin-css": patch
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

You can now put a document back to an earlier version.

Opening version history and previewing a version now offers a Restore action, behind a confirm that says what will happen. Restoring writes the document immediately and records the result as a new version, so nothing is lost and a restore made in error is undone by restoring again.

Restore reuses the ordinary edit permission — anyone who can edit the document can restore it, and every restore records who did it and which version it came from. History rows now show that lineage, along with the language a version was captured in.

Two limits are reported rather than hidden: values a version never stored, such as passwords, are left as they are; and if the schema has since dropped a field the version held, the restore says which fields it could not bring back.
