---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
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

Close server-side security gaps in the schema write/read pipeline and fix a component-field regression.

Component fields (`type: "component"`) can be saved again: the shared field-payload gate no longer rejects them for lacking a nested `fields[]` array, since a component field references a component by slug rather than embedding fields. Password fields are now protected everywhere they can appear: hashes are never returned through an expanded relationship (including the users entity's password hash), inside a component instance, or in a create/update response, and a password inside a component is bcrypt-hashed on write instead of stored in plaintext. Server-side validation now covers component instances and rejects an array value for a single-choice select/radio field, and editing an entry with a required password no longer forces you to re-enter it. Component definitions can no longer be listed without authentication, expired sessions on the standalone routes refresh instead of hard-logging-out, rate-limited callers keep their `Retry-After` backoff, and the components route initializes before its permission check so a valid first request is not rejected.
