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

Publishing every language of a localized Single now tells each language's webhook subscribers what a publish of that one language would. A language that was already live and whose pending change goes live gets a `single.updated` event tagged with its locale; before, it got none. A language going live for the first time still gets `single.published`. For the default language, the untagged `single.updated` and the new tagged one both describe the write.

Each event's `previous` now holds the content readers saw before the publish. Before, it was built from translated values read after the pending changes were promoted, so it already held the new text.

When a pending change edited a field every language shares, the version a publish of every language records, and each event's current state, now hold the shared value it put live. Before, both kept the value from before the publish.
