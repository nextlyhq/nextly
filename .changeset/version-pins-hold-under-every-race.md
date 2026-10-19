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
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
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
---

Version pins hold under every race, and their handles belong to the feature
that registered them. Retention and a pin read the pins with a locking read,
so on MySQL a pin committed after a save's first read is still seen and its
version kept. A pin locks its collection's or Single's registry row, so a pin
racing that entity's deletion is refused rather than left behind.
`registerVersionPinHolder` now returns the holder's handle, and
`versionPins.holder(name)` is gone, so no code can reach another feature's
slots by name; Workflows registers itself when it ships rather than being
registered in advance. Orphaned collections removed by a sync, and orphaned
Singles removed by the dev build, take their pins and autosaves with them.
