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

Every repeater row now has a saved `id`. Rows get one when they are written, at every nesting level. Ids you send are kept, and a repeated id is given a fresh one. A row sent without an id keeps its stored id only when it is unchanged at the same position; otherwise it gets a new one. The admin gives a row an id when you add it, and restoring a version keeps repeater row ids.

API answers now include `id` on repeater rows after a save. Existing rows get their ids on the next save that sends their repeater; an update that leaves the repeater out doesn't touch it, and there is no backfill. That first save shows those rows as changed in version history and in webhook `changedFields`.

Password fields inside repeater rows: when a write leaves a row's password out, the stored one is kept. Rows are matched by the ids the writer sends, and a writer that sends no ids is matched by position, as before. Matching no longer counts the ids rows now carry in storage. So a writer that never sends ids keeps its rows' passwords, a reorder by id keeps each password on its own row, a removed row's password is dropped, and a copied row gets none.

Compatibility: a write that sends a repeater row without its `id`, leaves that row's password out, and changes the row's other values is now refused with `ROW_ID_REQUIRED`. This applies only when the saved row has an `id` and a password. By position alone, a reorder could hand one row's password to another. Send each row's `id` from your last read, or send the password again. A repeater whose rows declare their own `id` field keeps that value as written, and its rows get no saved id.
