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

The page builder exposes its block registry as a service, and a contributing plugin reaches it from `init` with `blockRegistry(ctx).register(myBlocks)`. Registering this way rather than by importing the engine is what makes the timing safe: the block registry is cleared and rebuilt on every boot, so a direct call can land before the rebuild and lose the blocks with no error, while services are recorded before any plugin's `init` runs. Each block is attributed to the plugin that registered it, taken from that plugin's own identity, so a name collision names the packages actually responsible.

`defineBlock` and the block types come from `@nextlyhq/plugin-sdk/blocks`, keeping the SDK the one stable surface a plugin author imports from while a plugin that has nothing to do with blocks never pulls the engine into its type graph. The registry itself comes from `@nextlyhq/plugin-page-builder/blocks`, since it belongs to that plugin rather than to core. Custom supports are registered through the same service as blocks, so both share the per-boot reset and neither collides on a second boot. Nextly core is unchanged: it carries no blocks contribution key and does not depend on the block engine, because contributing blocks is contributing to the page builder rather than to the framework.
