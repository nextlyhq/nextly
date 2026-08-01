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

Collections with Draft/Published now record when an entry first went live, in a new `firstPublishedAt` timestamp.

Until now a row only said what it IS. Unpublishing sent it back to draft and erased every trace it had ever been public, even though the inbound links, feeds and search results it collected while live were still out there. Anything that needs to ask "was this address ever public" had nothing to read.

The value is set once, on the first transition into published, and never changes afterwards: it is the date of the first publication, not the most recent one. It survives an unpublish, and it stays empty for an entry that has only ever been a draft. Entries that already existed keep an empty value, because whether they were once published was never recorded and cannot be recovered after the fact.

Collections without Draft/Published do not get the column: they have no unpublished state, so there is no transition to record. Singles do not get it yet either.
