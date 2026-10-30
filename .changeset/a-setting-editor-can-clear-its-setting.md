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

A setting's own editor (`@experimental`) gets two fixes.

- **`SettingEditorProps<Value>["onChange"]` takes `Value | undefined`**, so an editor can clear an optional setting: `onChange(undefined)` saves the setting unset, and the card reads its default, or no value where it has none. This is a widening of the parameter: an editor that calls `onChange` with a value keeps compiling unchanged. Only code that builds `SettingEditorProps` itself, with an `onChange` that accepts `Value` alone, needs its callback to accept `undefined` too.
- **An editor for a Field setting is held to the fields the chosen collection offers the reader** in the settings sheet. A field the collection does not offer is named under the editor on Done ("names a field that is not available", the words the layout write refuses it with) and nothing is saved, rather than failing the whole sheet's save. The check is the layout write's own field-fit rule (`unfitContentField`).
