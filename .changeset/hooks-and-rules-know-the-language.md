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

Hooks, validators and events now know the language. A hook's context carries `locale` (the language written or read, absent when the operation spans several), `locales` (every language involved) and `shared` (whether the operation moves the shared part), marked `@experimental`. An update's `originalData` and `data` hold the document in the language written, its translated values included, rather than the main row alone. A publish of every language runs its after-hooks once for each language whose pending change goes live, each told its language, and a Single's publish of every language runs them as a collection's does. A field's own `validate` gets `req.locale`, as a plugin type's validator gets the write's language. The outbox envelope and the activity record gain `locales` and `shared`; a publish of every language and a delete name their languages; and the in-process collection events gain `locale`, `locales` and `changedFields`.
