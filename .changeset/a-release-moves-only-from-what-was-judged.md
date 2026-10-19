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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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

A release moves only from the state it was judged in. Every change to a
release (scheduling, cancelling, stopping, publishing, and adding or removing a
document) now advances its revision, and scheduling compares against the one it
read: a document removed while a release is being scheduled makes the schedule
refuse, rather than leaving a single-document release scheduled with nothing.
A release's capabilities now say what a single-document release allows: no
scheduling while it is empty, no second document, and no removing its document
once scheduled.

For code calling `ReleasesRepository` directly: `scheduleRelease`'s
`expectedRevision` (added as optional with Publish now) is now required, and
`from` no longer has a default. A schedule fenced only on state cannot tell
that a release changed under it, so every scheduling move must name the
revision it read: read the release, then pass its `revision`.
