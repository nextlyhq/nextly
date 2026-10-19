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

A release pass that the host ends part-way, at a serverless function's time limit for
example, now makes progress on the next pass. A document already where its release action
leaves it in every language, holding no working draft, counts as applied without being
written again, so its hooks and outbox events no longer run twice and the next pass reaches
the documents still to go. Before, the next pass rewrote everything it had already written,
and a pass ended at the same point every time never finished. A document holding a working
draft is still written, because that draft is what the release puts live, and so is one with
a translation not yet where the action leaves it. The status is read from storage, not through
read hooks, and a document counts only for an author the write would still let act. A write
refused to an author who lost the permission no longer counts as applied just because the
document was already where the action leaves it, so that release is no longer marked
published.

`createReleasesDrainJob` takes an optional `settlement` (the stored lifecycle and the
author's access gate), which the built-in registration supplies. A drain job created without
it writes every action, as before. For the same reason the `settled` check on the mutations
`applyDueReleases` is given is optional: mutations without it are written as they always
were.
