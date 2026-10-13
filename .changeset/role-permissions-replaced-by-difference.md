---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/builder": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

A built-in role can no longer be left without its permissions. Replacing a
role's permissions deleted all of them and then inserted the new set as a
second write, outside a transaction, and every boot did it for every preset
role. A serverless instance frozen between the two writes, or an insert that
failed, left the role empty until another instance started. The permissions
are now changed by difference, in one transaction under a lock on the role, and
a role whose permissions are already right is only read, so concurrent cold
starts no longer rewrite them.

The boot started by `getNextly()`, as in `instrumentation.ts`, now finishes
permission and role seeding before it resolves, as the request-path boot
already did. Plugin-declared roles are seeded on both boot paths. Seeding keeps
quiet only about a table that does not exist yet, and logs any other failure
as an error naming the step. A production build (`next build`) seeds nothing:
the first runtime boot does it before it serves.
