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
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
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
---

A comparison can start from the version you last looked at. The admin marks
a version as seen with `PUT …/versions/{n}/seen` when it shows one, for
signed-in people only (API keys and the system are refused), and no read
records anything. Marks count by visit: a mark more than 30 minutes after a
marker's last one starts a new visit, and "last looked at" is the furthest
version of the previous visit, kept per person, document and language. The
`last-viewed` baseline compares from it, falling back to the nearest older
version when retention removed it and naming the one removed, and the
history list marks the row where you last looked. Markers live in a new core
table, `nextly_version_views`, which `nextly migrate` creates, and go with
their document, collection, Single or person.
