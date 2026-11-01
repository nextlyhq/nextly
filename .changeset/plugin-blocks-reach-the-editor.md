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

Blocks a plugin contributes now reach the page builder's editor. A plugin declaring blocks names an `editorEntry`, a module exporting the same definitions; `nextly generate:types` imports it in the admin's component map, and the editor offers those blocks in the Add panel and its search, with an inspector, and opens stored pages holding them without a placeholder. A block's own inspector (`editor.component`) is drawn in place of its generated content controls and given `{ node, props, commit, readOnly }` (`BlockInspectorProps` from `@nextlyhq/plugin-sdk/blocks`, experimental). Block code can read the document and window it is drawn in through `useBlockEnvironment()` from the new `@nextlyhq/blocks-react/environment` entry. A block registered in code rather than declared reaches the server only, and development now says so once, naming it.
