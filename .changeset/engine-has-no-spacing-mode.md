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

The blocks engine has one spacing model: every page compiles with the gaps of the containers holding its blocks. `@nextlyhq/blocks-engine` no longer exports `SpacingMode`, `SPACING_MODES`, `DEFAULT_SPACING_MODE`, `isSpacingMode` or `spacingModeOf`, and neither the style compile context nor `SiteSheetInput` declares a `spacingMode` field any more; `@nextlyhq/blocks-react` no longer re-exports `SpacingMode`. A TypeScript caller that still imports one of these names or states `spacingMode` gets a type error and should remove it. A context or stored site style that still carries the key at runtime has it ignored, so container gaps are always written, as they already were for every site the page builder renders.
