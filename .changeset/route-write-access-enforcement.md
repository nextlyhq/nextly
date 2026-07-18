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
"@nextlyhq/eslint-config": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"create-nextly-app": patch
---

Enforce a collection's stored access rules on REST route writes.

A collection's stored access rules (`owner-only` / `role-based` / `authenticated` / `custom`) and field-level write access were enforced on the code-first Direct API but silently skipped over the REST route, because route writes forced a full `overrideAccess` bypass — the route only ever ran the coarse RBAC gate, then skipped the stored rules it had never checked. A rule such as "authors may only edit their own posts" was therefore not enforced over HTTP.

Route writes (collection single, bulk, and singles update) now run with the real user and `overrideAccess: false`; the route's `routeAuthorized` flag only elides the redundant RBAC re-check the middleware already performed, while the stored rules and field-level write access are enforced with the caller. `overrideAccess: true` remains the explicit trusted-server escape (seeds, plugin `as:'system'`), and super-admins bypass the stored rules on every transport.

Behavior change: collections that declared stored access rules — and were relying (knowingly or not) on the REST bypass — now have those rules enforced over REST. Collections without stored rules are unchanged.
