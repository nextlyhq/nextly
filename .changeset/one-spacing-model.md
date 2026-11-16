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

The classic spacing model is removed. Remove `spacingMode` from `pageBuilder({ siteStyle })`. Pages compile with container gaps: blocks have no outer margin of their own, and the space between two blocks is the gap of the container holding them, set per container or by the spacing variables.

What went with it:

- the **Space between blocks** switch under **Design → Variables**;
- the `/site/style/spacing-mode` route;
- the `siteStyle.spacingMode` option;
- the engine's `SpacingMode`, `SPACING_MODES`, `DEFAULT_SPACING_MODE`, `isSpacingMode` and `spacingModeOf` exports, and the `spacingMode` field of the style compile context and `SiteSheetInput`.

A site recorded as classic renders with container gaps after the upgrade, and its leftover record is cleared the next time its site style is saved. No migration step is needed. The Page Builder docs now describe the one model.
