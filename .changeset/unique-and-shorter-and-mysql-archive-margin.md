---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
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

Two follow-ups to recent schema-save and localization-archive fixes.

- A collection save that makes a field unique and shortens it at once checks both: a value longer than the new length is refused, naming the field, rather than truncated by PostgreSQL's cast while the save succeeds.
- On MySQL, an archive row from before the archive recorded its entity's kind is matched to an entity only when it was archived more than 42 hours after the entity's recorded creation (14 on PostgreSQL). On MySQL the creation time, the archive time and the reading of it are all in the session's time zone, which may differ each time, so a narrower margin could give an older entity's translations to a newer one with the same slug. Rows inside the window stay unresolved: kept, reported by a restore and restored by naming their kind.
