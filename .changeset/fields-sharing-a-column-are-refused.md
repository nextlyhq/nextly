---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

Two sibling fields that share one stored value are now refused wherever a definition is read or written, an entity that already holds them included. That covers two fields at an entity's top level that become one column (`Title` and `title`, `siteName` and `site_name`) and two fields of the same name inside a group or a repeater (one key of its value). Before, only a change that created such a pair was refused; an entity that already held one kept working, and `nextly migrate:check` warned. Now a Builder save, the services and the Direct API, `nextly migrate:create`, `nextly migrate` and `nextly migrate:check` refuse it, and so does a start for configuration in code. For an entity made in the Builder, the start logs the pair and goes on, so the Builder can rename one of the two, while every save of its definition is refused until then. The refusal names the entity, the container, both fields and the column or key they share, and says to rename one so each has its own. `define*` refuses such a pair at a field group's top level too. A held pair that shares no stored value (two names that differ only in letter case inside a group, or two fields without a column) still keeps working, and `migrate:check` still warns about it.
