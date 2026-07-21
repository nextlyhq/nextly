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

CLI commands now explain why they failed.

Errors carry two messages: a safe one for the browser and a detailed one for whoever is running the code. The CLI was printing the safe one, so a failed `nextly db:sync` said only "An unexpected error occurred." with no table, no query and no cause. The same command now reports the failing query and the database's own explanation, for example `no such column: "localized"`, which is usually the whole answer. Full stack traces remain behind `DEBUG=1`.

A crash inside Nextly is also no longer reported as a validation error. Creating or updating a collection returned HTTP 400 "Validation failed" when the real cause was a defect in Nextly itself, sending people to search their own payload for a problem that was never there. Those now return 500, so the two cases can be told apart.
