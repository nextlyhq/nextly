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

"Publish all languages" and "Unpublish all languages" on a collection entry now run through the same update path as any other edit, so update hooks, field rules and validation apply to them.

Moving every language at once, from the button or from a scheduled release, now applies every language's pending change instead of refusing when another language holds one. A shared field keeps the edit of the language that changed it, and when two languages changed the same shared field the later save wins. Each language's translations, including those inside components, come from its own pending change. A pending change held for a language the app no longer configures is left in place.

When publishing every language fails, the admin now shows the server's reason instead of one fixed message.
