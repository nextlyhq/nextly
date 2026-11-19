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

Reads in a language and the hooks of a translated write tell the same story as the content.

- On a public read, the translation overview reports a language a due release publishes as published, as the read itself and its language filter already do, for collections and Singles.
- A related document's publication in the read's language is judged on the translations fetched with it, in the same statement.
- A trusted read of every language that shows a pending change carries, beside it, the field groups that change holds for its language; a field group with no translated field is no longer repeated beside the read for each language.
- The hooks after an update, and its events, are told whether the shared part moved from the payload as persisted, so a field a hook adds or a field rule removes counts. A read made inside a write's hook is told nothing of the shared part. On an entity without a lifecycle, a field named `status` is treated as an ordinary field. Each hook is handed its own copy of the language list, and hooks configured in the admin are told the language, the languages and the shared part as code hooks are.
- The in-process `collection.<slug>.*` events of writes made in a caller's transaction, one by one or in a batch, carry `changedFields`, and every in-process event names its changed fields from the same sanitized documents as the outbox envelope, so a hidden or password field is never named.
