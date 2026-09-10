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

Which settings a _component_ may carry is part of that list, because the manifest
refuses version history, retention, cache revalidation and webhook recording on
one — a component has no entries of its own, so those belong to whatever embeds
it. It refuses the key rather than the value, so a shared projection had to leave
them out rather than send `false`.

A description is also trimmed in one place now — the settings form both writes
read from — so the record in the database and the entry in the file can no longer
disagree about one with spaces around it. Clearing a description still sends the
value that clears it, which is not the same as saying nothing about the field. And saving a field group's fields before its settings have
loaded no longer replaces its entry with a nameless one.
