---
"nextly": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/ui": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"create-nextly-app": patch
---

Populate a valid `slug` when a title has no URL-safe characters, and re-sanitize hook-set slugs.

Creating an entry whose title is entirely non-ASCII, emoji, or punctuation (for example `create({ data: { title: "你好世界" } })`) previously produced an empty slug and failed required-field validation, because slug derivation stripped every character. It now falls back to a unique generated token so the required, unique `slug` column stays populated. Additionally, a slug set by a field-level `beforeValidate` hook is re-sanitized before validation and storage, so hook-provided values stay URL-safe.
