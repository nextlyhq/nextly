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

Carry the authenticated caller (identity and roles) through REST paths that previously ran without full context, so access control, hooks, and response redaction resolve against the real user.

- **Bulk update by query** (`PATCH`-style bulk-by-`where`): now runs as the authenticated caller instead of anonymously. Per-entry access checks and hooks receive the user, and the response is redacted to what that user may read, matching the id-based bulk-update path.
- **Standalone Single detail route** (`nextly/api/singles-detail` `PATCH`): forwards the authorized identity (including roles) into the update, so the response is redacted for that user, matching the dispatcher's single-update path.
- **Roles in access evaluation**: route-authenticated write requests now carry the caller's role slugs to the service layer, so collection-level `role-based` rules and field-level `access.read` evaluate against real roles instead of an empty context. Role-based rules match on ANY held role (documented OR-logic) for the many-to-many user/role model; the single `role` field is still honored, so existing single-role setups are unchanged.
