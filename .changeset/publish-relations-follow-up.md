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

A batch publish (`updateEntries`) now judges each entry's components and
many-to-many relationships as they are stored once the batch holds that
entry's lock. It used to read them for every entry of the batch while
holding the first entry's lock only, so another writer that changed a later
entry before the batch reached it could leave it judged on values no longer
stored: published without a required relationship, or refused though repaired.

Publishing a pending change saved before a required component or many-to-many
field was added now refuses it while that field has nothing stored, rather
than letting it go live unjudged.

A required component is now relaxed outside the default language on a
document whose only translated values sit inside a component, as it is on one
with translated fields of its own.

A release's readiness check, and the judgement a status-only publish makes
before it writes, read a component table not created yet as empty, as other
reads off a transaction do, rather than failing.

Reading a localized dynamic zone now reads each kind's translations once for
all its instances, not once per instance.
