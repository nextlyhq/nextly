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

In the Schema Builder's outline, a blocks field now shows beneath it each registered block it accepts, named as the page editor names it, with that block's props, read-only and naming the plugin that registered it. An allow-list entry no registered block matches is said beside the field, and the row says when the blocks are still loading, could not be read, or need the Page Builder plugin. The Page Builder serves this from a new read, `GET /plugins/@nextlyhq/plugin-page-builder/blocks` (with an optional `allow` list), open to any signed-in user and answering code-defined block metadata only. `@nextlyhq/blocks-engine` now exports `slotAdmits`, its one reading of a block allow-list, which the blocks field's validator now uses too; `@nextlyhq/builder/ops` offers `fieldLabel` and `propLabel` (experimental).
