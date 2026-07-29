---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

Programmatic entry writes now emit webhook events. Writes through the transaction API (`createEntryInTransaction`/`updateEntryInTransaction`), the batch helpers (`createEntries`/`updateEntries`), and `publishAllLocales` previously recorded no webhook events, so importers, agents, and plugins writing through them were invisible to webhook subscribers. These paths now record `entry.created`/`entry.updated` and the corresponding `published`/`unpublished`/`status_changed` lifecycle events inside the write transaction, so an event is delivered for every entry write and is never emitted for a write that rolls back.
