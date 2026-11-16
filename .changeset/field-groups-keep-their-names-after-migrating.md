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

Field groups keep working after `nextly migrate:field-groups --apply` moves their storage to the current names. A development start, a config reload and `db:sync` now use each group's stored table, so an edit to a code-first group applies instead of being reported on every start as not matching a derived `comp_` name. A group created afterwards, in code, in the Schema Builder or through the Direct API, is created as `fg_<slug>` with the `_field_group_type` column in `dynamic_field_groups`, so running the storage migration again finds nothing to do. Before this, a Schema Builder or Direct API create on such a site failed with "no such table: dynamic_components". Deleting a translated group and resetting the system tables now remove only the current names. Sites that have not migrated keep the legacy names, and new sites still start on them.

An edit to a code-first field group now applies at the next development start on MySQL. The change was judged against a description of the table that typed its timestamps differently from the table itself, so on MySQL every edit was set aside as needing review.
