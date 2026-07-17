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

Carry the authenticated caller through two REST paths that previously ran without a user context, so access control, hooks, and response redaction resolve against the real user.

- **Bulk update by query** (`PATCH`-style bulk-by-`where`): the request now runs as the authenticated caller instead of anonymously. Per-entry access checks and hooks receive the user, and the response is redacted to what that user may read, matching the id-based bulk-update path.
- **Standalone Single detail route** (`nextly/api/singles-detail` `PATCH`): the route now forwards the authorized identity into the update, so the response is redacted for that user, matching the dispatcher's single-update path.
