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

A production start makes fewer database round trips, and a Single saves a field its configuration declares.

- A start reads each field group's stored table only where a plugin or the app declares a schema extension that needs it. A site whose configuration declares no language with a region part (such as `pt-BR`) no longer checks for older spellings of its language codes, and so no longer reads or writes a `nextly_meta` row for that check. The per-language layout check takes the field groups' registry rows from the start's own reading. A start with no plugins again makes at most 20 round trips one after another.
- On PostgreSQL, a production start reads the columns of a translations table, to name a date column an earlier release made with a time zone, only for an entity with a translated date field.
- A Single's save accepts a field the running configuration declares when the registry row was written by an earlier build, and judges it by its rules. Before, a production start served that field but a save of it was refused with `UNKNOWN_FIELD`.
- A version history read, and an editor's autosave check, read a collection's registry row from the registry row cache. Admin screens read no registry row again once they are warm.
