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

Emit a `form.submission.created` webhook when a form submission is created. The event type was already subscribable in the admin UI but had no producer, so an operator could subscribe to an event that never fired.

Form submissions carry visitor-entered answers plus `ipAddress`/`userAgent`, so the submissions collection suppresses the PII-bearing `entry.*` events. It now instead emits a curated, metadata-only `form.submission.created` carrying only which form, when, and the status — never the answers, IP, or user agent. The event is recorded in the same transaction as the submission, so it commits atomically and is never delivered for a rolled-back write.

This is driven by a new declarative `webhooks.emit` collection option (`{ event, fields }`): any PII-bearing collection can replace its default `entry.*` events with a safe curated one that ships only an allowlisted set of fields (default-deny). The resource kind is derived from the event name.
