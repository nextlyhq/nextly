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

The page builder opens on its default panel when a browser still remembers a panel it no longer has, such as Insert, Tokens, Classes, Fonts or Settings, rather than mapping old names to new ones. Settings is no longer one of the builder's left panels: it opens only as the dialog the host draws, so the rail lists Add, Layers, Pages, Components and Design.

**Breaking change:** `@nextlyhq/plugin-page-builder/admin` no longer exports `BlocksSummary` or its `BlocksSummaryProps` type, and the component path `@nextlyhq/plugin-page-builder/admin#BlocksSummary` is no longer registered. The blocks field's own control, `BlocksField`, already shows what a field holds and links to the editor, so use it instead.
