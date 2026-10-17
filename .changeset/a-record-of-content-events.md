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

Nextly gains a record of content events, ready for the features that write
to it: what happened to a document or a release, who or what did it (a
person, an API key, a plugin-defined person, a release or the system, with
the name they had then), when, and optionally the state before and after, a
note, the version, a small kind-specific payload and a definition hash. The
languages and shared fields an event involved are kept as parts, so history
can be filtered and paged by language. Event kinds are registered by the core
features that write them, and an event is written in the same transaction as
the change it records. Nothing writes events yet. A subject's events are kept
while it exists, and removed once the activity log's retention window has
passed since its deletion, by the write paths' retention pass and the
scheduled drain alike. Two new core tables, `nextly_content_events` and
`nextly_content_event_parts`, are created by `nextly migrate`.
