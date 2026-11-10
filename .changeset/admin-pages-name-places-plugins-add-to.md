---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

Admin pages now have named places a plugin can add to (experimental).

- Core names nine: `dashboard`, `collection.list`, `collection.edit`, `single.edit`, `entry.form`, `settings`, `user.detail`, `account` and `login`. They are exported as `CORE_ADMIN_PLACES`, with the `AdminPlaceId` type, from `@nextlyhq/plugin-sdk`, `nextly` and `nextly/config`.
- A plugin declares places of its own in `contributes.admin.places`, each named with its slug and a dot (`"acme-billing.invoice"`). It types them by augmenting `AdminPlaces` from `@nextlyhq/plugin-sdk`, so a misspelled place does not compile.
- The app refuses to start, naming the plugin and the place, on a place:
  - outside the plugin's namespace;
  - under a segment core reserves, including a plugin whose own slug is one;
  - that is malformed;
  - that is declared twice.
- Nothing renders at a place yet.
