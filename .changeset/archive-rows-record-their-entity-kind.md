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

The localization archive records which kind of entity each value came from, so a field group that shares its slug with a collection or a Single keeps its archived translations to itself.

A field group's slug can equal a collection's or a Single's. Until now the archive kept only the slug, so restoring one entity read the other's archived values as well (the restore failed part-way when it tried to write them into the wrong table), and deleting one entity removed the other's archived values too. Each row now records `collection`, `single` or `fieldGroup` in a new `entity_kind` column, and restore and delete act only on rows of their own kind.

- `nextly migrate`, and boot, add the column to an existing archive, and a Schema Builder save that archives brings an older archive up to date on its own. Rows written before the column existed are matched to their entity when exactly one holds their slug, counting only rows archived since that entity was created. The rest are kept, never deleted, and a restore of their slug reports them; `--kind` claims them.
- `nextly i18n:restore` takes `--kind collection`, `--kind single` or `--kind field-group`. It is needed only when the slug names more than one kind; without it, such a restore is refused and the kinds are named.
