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

A collection made in the Schema Builder carries a title and a slug without declaring them, one value for every language. The admin now knows that they are not translated. An unsaved edit to one counts as a shared change when Publish decides whether to ask, the editor marks it as shared, copying from another language leaves it alone, a restore treats it as shared, and an entry list no longer offers its title in another language. A `title` or `slug` you declare keeps its own setting, and nothing stored changes.

Publish in the editor of a translated document now saves unsaved work first where somebody already reads the document, then decides from what is stored whether to ask. A hook that changes a shared field from a save of one language's text no longer has that change published for every language without asking. With nothing unsaved it is one click as before, without a save.

In the dialog that chooses what to publish, a part approved there can be published at once, without closing it.
