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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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

A plugin can hold an entry its write names: `ctx.services.collections.holdEntryInTransaction`
(experimental) holds the entry's row for share in the write's transaction and answers whether
it exists, so the write either commits before a delete of the entry goes on, which then sees
it, or waits and is told the entry is gone.

The page builder uses it for an entry's own design, on every path that creates one, the
Direct API included: a design written while its entry is deleted is refused, or deleted with
the entry, rather than left naming an entry that is gone. Every write to a template has what
it serves judged again in its own transaction, so a later hook cannot store a row naming both
a collection and an entry, and an empty value for a field naming an entry is refused (a
form's cleared input is stored as none). A title made from an entry's title is cut to the
length the title field counts, never splitting an emoji. Deleting a template now empties its
link on a published design's live row too, without publishing a draft that waits on it.

On MySQL a collection's named lock is named for the database as well as the collection, so
two Nextly databases on one server no longer wait on each other's collection deletes.
