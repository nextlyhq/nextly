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

The page builder can now reach the database from inside a save, to maintain its class-usage
index.

The decisions - which subjects a save owes an update to, and how one subject's rows are
reconciled - already existed and take their database access as an interface so they can be
tested against values. This is the one place those interfaces become real calls, through the
Direct API a hook is handed.

Three mappings carry it, and each is a way the index gets filed against the WRONG document
while every layer above reports success.

The working draft is overlaid only for a DRAFT subject. The two variants are separate rows
precisely because the two documents can differ; omitting the overlay for a draft subject
records the published row's classes as the draft's, and passing it for a published subject
does the reverse wherever a draft exists.

A SHARED field asks with no locale rather than with the empty string. A shared field stores
one value every language reads, and that value is what a read with no locale resolves to;
asking for the `""` locale asks for a language nobody configured.

Documents are read at depth 0. The rows derive from the stored blocks JSON, and populating
relationships replaces ids with documents - changing the shape the derivation walks, while
adding reads a save does not need. A missing document resolves to nothing rather than to an
error, which is the right reading for an untranslated locale or a document with no pending
draft.

Index writes are made as the SYSTEM. The table's access rules deny everything and they are the
only thing keeping these rows private - `internal` sets `admin.hidden` and nothing more - so a
write that respected the acting user would fail for every user and the index would never be
maintained.

A response carrying no rows is read as an empty page rather than a failure, which is the state
every site is in before its first save.
