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

Each save of a Single by a person or an API key is now recorded in the activity trail, in the same transaction as the save and whether or not webhooks or audit are on: a save, a held draft edit, a publish or unpublish (one row, however many languages it moves) and publishing every language each record one update, and an autosave records nothing. Recent activity heads a Single's row by its label and shows it only to someone who may read that Single. Hidden and internal Singles are left out of Recent activity and the 24-hour figure, judged by what each row is about, so a hidden Single no longer removes the rows of a collection with the same slug. Each entry in the dashboard's activity response now carries `subjectKind`: `collection`, `single` or `settings`, or `null` for an older row.
