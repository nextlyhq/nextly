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

**Behaviour change.** A code-first collection or single that declares a field named `id`,
`createdAt`, `created_at`, `updatedAt` or `updated_at` is now refused when the config is read,
instead of failing later during schema application. Any casing that resolves to one of those
columns is refused too, so `CreatedAt` is caught alongside `createdAt`.

Such a collection could never have worked: the field is emitted alongside the injected column and
the database rejects a table that declares the same column twice. The error now names the column
it collides with, and arrives where the name is chosen.

`title`, `slug` and `status` are unaffected and remain declarable — the first two step aside for
an author's own field, and a `status` field is taken up by the draft/publish lifecycle.
