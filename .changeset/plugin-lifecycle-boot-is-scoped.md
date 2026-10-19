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

A lifecycle command's boot initialises only the plugin it is installing or
uninstalling, and a disabled plugin is refused by install and uninstall.

## Changes in behaviour

- **A lifecycle command's boot initialises only its target.** An install or an
  uninstall no longer starts the other configured plugins against a schema the
  command is changing.
- **Install and uninstall refuse a disabled plugin** (`PLUGIN_DISABLED`). Its
  hooks do not run while it is disabled, so no installed or uninstalled record
  is written for them.

## Compatibility

The schema-event type exported by `nextly/schemas` gains a `plugin_lifecycle`
value, which records a plugin's install state in the migration ledger. Code
that switches exhaustively over `eventType` must handle it.
