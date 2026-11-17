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

The page builder calls each reusable part by one plain name everywhere. Upgrading changes the labels the page builder's collections and settings store, which are settings: run `nextly migrate:create` and `nextly migrate` so the admin's lists and forms show the new names. Nothing else changes: no column, stored field or value, collection slug, API path, permission or transfer-file key moves, and no data moves.

The names: "Header & footer" (a named one is a "header & footer set", such as "Main"), "Saved sections" (once Patterns), "Components" and "Collection templates" (once Templates), in the admin's panel, the Page Builder overview, the editor, dialogs, notices, errors and the docs. The overview says what each one is in one line. The Add panel's tabs read "Blocks" and "Saved sections", and a component's area reads "Use as", with Header, Footer and Anywhere. Saving a selection is "Save as section…" on the block bar, its menus and the command palette alike, and the toasts say "Saved to Saved sections", "Turned into a component. Edit it once and every page updates." and "Detached. These blocks no longer update with the component."
