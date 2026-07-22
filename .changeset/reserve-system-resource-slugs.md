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

Collection and single slugs that collide with a system resource are refused.

Permission identity is `action-resource`, so a content type named after a system resource is granted the same permission rows that resource's routes check. A `webhooks` type reaches the endpoint routes and their signing secrets; a `settings` type reaches the user-fields and component admin surfaces (gated on `{action, "settings"}`, not only `manage`); a `media` type reaches the media routes. Every system resource has such a route, so any system-resource name — `users`, `roles`, `permissions`, `media`, `settings`, `email-providers`, `email-templates`, `api-keys`, `webhooks` — is now rejected as a collection or single slug.

The check is enforced at every slug-assignment path: code-first validation, the shared collection/single registry guard (create and rename), the Schema Builder's collection registry, and the migration-snapshot boot path (which skips a reserved name rather than replaying it). Components are not restricted, because a component definition does not seed a permission under its own slug.

An installation that already has a collection or single named one of these must rename it before upgrading.
