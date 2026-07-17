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

Forward the authenticated user's roles into access-control evaluation so role-based rules work over REST.

- Route-authenticated write requests (create/update/delete/duplicate/bulk) now carry the caller's role set to the service layer, so collection-level `role-based` rules and field-level `access.read` evaluate against the real roles instead of an empty context.
- Role-based rules now match on ANY held role (documented OR-logic) for the many-to-many user/role model. The single `role` field is still honored, so existing single-role setups are unchanged.
