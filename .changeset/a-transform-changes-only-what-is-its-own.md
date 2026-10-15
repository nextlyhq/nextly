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

A plugin's entity transform can no longer change what isn't its to change.

A transform hands back a whole new definition of a collection, Single or
component, so nothing stopped it from setting an option the entity's own
definition is refused for, such as a collection's `db.idType` of `"serial"`,
or from dropping another plugin's column. Each transformed entity is now
validated as its definition would be, and a refusal names the plugin.

A plugin transforming another plugin's entity must now list that plugin in
`dependsOn`, so the owner can't be uninstalled from under the change. It can't
move the entity to another table, and it can't remove a field, or change how
one is stored, unless it declared that field. An access rule, hook, validator
or admin setting a third plugin contributed stays unless the transforming
plugin depends on that plugin too. A plugin that transformed another's
collection without declaring the dependency stops at boot until it does.
