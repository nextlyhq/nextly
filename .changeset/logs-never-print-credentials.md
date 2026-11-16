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

Nextly's logs no longer contain credentials. Saving or reading a Single, and listing entries, collections, media or users, logged the call's options, and those carry the request: the caller's `Authorization` header (an API key) and session cookie were written to the server log, in production too. Every log writer (service loggers, including one an app passes in; the structured logger; the database and auth loggers) now takes out request, response and headers objects, fields named like a credential (`authorization`, `cookie`, `password`, `token`, `apiKey` and similar), and `Bearer` or `Basic` credentials in text, in every environment. Those log lines now name only the Single, its language or the collection.

**If you ran an earlier version:** your server logs may hold API keys and session cookies of people who saved or read Singles. Rotate the API keys that were used, sign out existing sessions, and delete or expire old logs where your host allows.
