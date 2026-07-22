---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

Collection, single and component slugs that collide with a system resource are refused.

Permission identity is `action-resource`, so a content type sharing a system resource's name is granted the same permission rows the system routes check: a `webhooks` collection's `read-webhooks` reaches the endpoint routes and `update-webhooks` the signing secrets, and `api-keys`, `email-providers` and `email-templates` collide the same way. The reserved set is exactly the system resources whose routes enforce a create/read/update/delete action; `settings` and `media` are intentionally left usable as content, because the settings surface is gated on `manage` (which content never seeds) and media's routes are not gated on the CRUD permissions a content type would mint.

The check is enforced at every path that assigns or renames a slug — code-first validation, the shared collection/single registry guard, the Schema Builder's collection registry, and dynamic component registration — so it cannot be reached through a rename or a create path that skipped the others. An installation that already has content named one of these must rename it before upgrading.
