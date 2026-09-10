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
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
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
---

Choosing how many versions a collection keeps, and then editing that collection
in the Builder, silently discarded the retention setting from `ui-schema.json`.
The create path wrote it and the edit path did not, and the file is updated by
replacing the whole entity — so the next edit replaced an entity that had the
setting with one that did not.

Six places each built that file's entry by hand, and each had forgotten a
different setting. They now share one projection, and which settings the file
carries is declared in a single list that the compiler checks: adding a Builder
setting no longer compiles until somebody has said whether the file carries it.

A blank description is also normalised in one place now, so the record written
to the database and the entry written to the file can no longer disagree about
whether a field group has one. And saving a field group's fields before its
settings have loaded no longer replaces its entry with a nameless one.
