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
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
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
"create-nextly-app": patch
"nextly": patch
---

The editor's review is steadier. "Ready to publish?" asks the comment a step requires before taking it; the side panel's Review steps wait while edits are unsaved, as the header's do; the header's steps are held while one is on its way; Publish waits until the review state is known; the Review section stays in the side panel when a plugin replaces Status; a commented step refused as stale is retried with the parts as they now stand; and a refusal in "Choose what to publish" reads at 4.5:1 in light and dark.

A publish without review records, in its history, only the parts it went past without an approval. The publish gate says "The shared fields are in …" and "have no current approval". In a batch create, an effect a publish gate holds for the commit while giving its early answer no longer outlives an item that is then undone.
