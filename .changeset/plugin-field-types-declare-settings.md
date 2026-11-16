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

A plugin field type can declare its own settings, and the Schema Builder's settings panel draws them for every field of the type. Each setting is a text box, a number, a switch or a choice, declared in `contributes.fieldTypes[].settings` with a `key`, a `label`, an optional `help` line and the tab it belongs in. Settings declared for General come first there, as the settings that make a field that type. Each value is kept in the field's `pluginOptions` under its key, which the Builder already saves and loads, so stored fields need no change.

A malformed list now refuses boot with a configuration error naming the plugin, the field type and the setting: a choice with no options or the same value twice, a key used twice, a key that is not one name, or the reserved keys `type` and `name`.

`PluginFieldTypeSetting` and `PluginFieldTypeSettingBase` are new, `@experimental`, exported from `@nextlyhq/plugin-sdk` and `nextly/field-catalog`, and `PluginFieldType` gains an optional `settings`. Nothing existing changes.
