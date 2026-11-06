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

A bulk or batch write is limited to the entries its access rule's filter matches, as a write to one entry is. A bulk update or delete by query changes only the entries the filter matches, and counts only those; an entry outside it is neither written nor named. A bulk update or delete by ids writes each entry the filter matches and fails each other one on its own: as a missing entry where the caller may not read it, and as refused where it may. A batch of updates or deletes in one transaction does the same for each item, and an item the caller may not read fails in the same words as one that does not exist. A by-ids bulk update that would move an entry out of the filter refuses that entry alone; inside a batch in one transaction, it refuses the whole batch, with nothing changed. The filter is matched in the default language, as the write to one entry matches it.
