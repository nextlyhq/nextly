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

`nextly.access.check` answers with the access decision every route asks. Two answers change. On media, settings and the Email hub, a `manage-` permission now counts as the plain read, create, update and delete it stands for, as every route already counts it, so a role holding only `manage-settings` may update settings by `access.check` too. And for a read, `true` now means the user may read some entries: where a collection's `read` rule answers a filter, the user may read only the entries the filter matches, so read with the user's context (`overrideAccess: false`) rather than as a trusted call, which returns every entry. A write whose rule answers a filter is still refused, and a check that cannot read the user's roles or grants refuses rather than throws.
