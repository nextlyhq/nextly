---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

Version history can now be turned on from the Schema Builder.

Collections and singles get a Version History switch on the Advanced tab of
their settings, so recording every save no longer requires editing
`nextly.config.ts`. Turning it on records each save as a version that can be
previewed and restored from the entry editor; turning it off keeps the versions
already recorded but stops new ones. It does not add drafts.

The setting is written to both the database and `ui-schema.json`, so a
Builder-made change survives the next manifest sync.
