---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
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

Deleting an account no longer leaves its identifiers behind in the audit trail.

`audit_log` rows carry an address and a client, and `actor_user_id` deliberately
has no foreign key so the trail outlives the account. An attributed write that
resolved its actor before a deletion but landed after that deletion AND its
post-commit sweep kept those identifiers permanently: nothing revisits the row,
and the account it names no longer exists for a later erasure to key on.

The decision is now made as part of the write, the way the activity trail
already made it, and both trails share one implementation so they cannot come to
answer it differently. Unattributed events, which name nobody, are unaffected.
