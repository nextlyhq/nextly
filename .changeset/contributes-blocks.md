---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
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
"@nextlyhq/eslint-config": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

A plugin can now add its own blocks to the page builder.

The page builder exposes its block registry as a service, and a contributing plugin reaches it from `init` with `blockRegistry(ctx).register(myBlocks, pluginName)`. Registering this way rather than by importing the engine is what makes the timing safe: the block registry is cleared and rebuilt on every boot, so a direct call can land before the rebuild and lose the blocks with no error, while services are recorded before any plugin's `init` runs.

`defineBlock` comes from `@nextlyhq/blocks-engine`; the page builder does not re-export it, because its package root already exports a different `defineBlock` from the PoC registry and shadowing that would silently stop existing consumers registering their blocks. Nextly core is unchanged: it carries no blocks contribution key and does not depend on the block engine, because contributing blocks is contributing to the page builder rather than to the framework.
