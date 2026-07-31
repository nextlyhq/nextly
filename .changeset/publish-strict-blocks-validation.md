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

Publishing a page now validates its blocks document more strictly than saving a draft does.

The document validator sorts problems into two kinds: structural corruption, which was always rejected, and preservable-but-unknown — a duplicated HTML id, a reference to a breakpoint the site does not define, an unrecognized document kind. Those were warnings on every write, so a page could go live emitting the same `id` twice and breaking its own anchors and labels. A write that publishes now treats them as errors, while a draft still accepts them so work in progress is not held to the standard of live content.

The status a write resolves to is the one the row will hold once it commits, so an edit to an already-published entry is judged as a publish even when it never mentions status. A collection with no publish lifecycle is unaffected.

Known gap: a publish sent as a status change alone, carrying no new content, is not yet re-checked, because validation runs on what the write supplies rather than on the resulting entry.
