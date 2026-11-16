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

Page builder: the site-wide "Space between blocks" switch is removed. Every site's blocks are spaced by the gap of the container holding them, so a site recorded as spaced by margins renders with gaps after the upgrade; its leftover record is cleared with the next save of the site style. No migration step or flag is needed. The `/site/style/spacing-mode` route is no longer served, and `siteStyle.spacingMode` is no longer an option of `pageBuilder()`: setting it is a type error, and an untyped configuration that still passes it starts with one warning and the value ignored. From the package root, `SiteStyleData` no longer has `spacingMode`, and `SiteStyleReader` no longer has `plugins`.
