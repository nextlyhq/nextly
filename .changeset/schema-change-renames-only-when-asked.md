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

A schema change sent through the REST API or a plugin no longer takes a field removed and another of the same type added for a rename by guesswork. The collection schema PATCH (`PATCH /api/collections/:id`), the Single schema PATCH (`PATCH /api/singles/:slug/schema`) and a plugin's `ctx.services.collections.updateCollection` take an optional `renames: [{ from, to, choice: "rename" | "drop_and_add" }]`, by field name. A change that makes such a pair without answering it is refused before anything is written, with `FIELD_RENAME_UNANSWERED`, naming the entity and both fields. `"rename"` keeps the field's values under its new name; `"drop_and_add"` drops the old field and its values and adds the new one empty.

**What to do:** a client, a plugin, or application code calling the exported `CollectionService.updateCollection` directly, that renames a field through one of these roads and relied on the rename being guessed, now sends `renames` with `choice: "rename"`. A field group or many-to-many field replaced by another of its kind is asked about the same way. The admin's Schema Builder is unaffected: it already asks about each rename.
