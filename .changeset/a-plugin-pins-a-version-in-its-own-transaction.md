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

A plugin can pin a version in its own transaction (experimental). `ctx.services.versions.pins.registerHolder({ name, label })` registers a version pin holder in the plugin's namespace, so two plugins naming a holder alike hold apart and none reaches one of core's. Its `pin`, `release`, `releaseAll` and `list` take `{ tx }`: the handle `ctx.db.transaction` passes its callback, or the transaction `ctx.services.collections.withTransaction` hands its work. A pin commits or rolls back with the plugin's own writes, under the same document lock and refusals as core's pins. The plugin SDK exports the types, with `VersionPinHolderDefinition` (what `registerHolder` takes) and `VersionRef`. A registered holder now reads its own slots as well: `holder.list(db, ref)` takes a transaction or the adapter and names the holder in the query, so what other features pin on the same document is never read.
