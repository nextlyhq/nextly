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

Field groups nest inside each other to any depth, and a field group placed inside itself is refused where it is written. The three-level limit `defineConfig()` enforced at start is lifted, so a configuration nesting deeper now starts. A field group placed inside itself, directly or through other field groups (including through a group, a repeater or a list of allowed field groups), is refused by `defineConfig()`, by the start when the cycle takes in a field group defined in code, and by every Schema Builder save, naming the field groups in the cycle. A cycle among Schema Builder field groups saved before this change does not stop a start: the start and CLI commands that load the configuration name it in a warning, and the next save of any field group in it is refused until one stops placing the next. Text values nested in field groups are sanitized at every depth, where they were reached only three field groups deep, and deleting a collection or Single removes its field-group rows at every depth.

Text inside a group without a name is now sanitized like any other text. Before, a text or textarea field placed in such a group was stored with its HTML intact, while the same field outside the group was stripped.

`MAX_FIELD_GROUP_NESTING_DEPTH` stays exported with its old value and is deprecated: nothing enforces it any more.
