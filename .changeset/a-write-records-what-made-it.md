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
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

An API key's write appears in the activity trail.

It recorded nothing before — not mislabelled, absent. The recorder refused any
actor that was not a signed-in person, because a row's identity column is
joined to the accounts table and a key's own id would find no account and be
filed as an already-erased person. So every write made with an API key was
invisible, and nothing about it is recoverable after the fact.

The row now carries the KIND of caller its identity column refers to, and the
admin's Recent Activity names the key rather than showing a blank actor.
`user_id` is unchanged and still required: it is already documented as the
actor's opaque reference, so one nullable `actor_type` is the whole schema
change and no dialect needs a nullability rebuild.

A NULL kind means a row written before this existed. Those are all user writes,
because no other kind was recordable.

Writes with NO initiating actor — seeds, migrations, imports and jobs — are
still not recorded, and the reason has changed rather than gone away. They run
while the schema is being created, and a failure to write the trail fails the
surrounding write: a trail insert against a table that does not exist yet would
fail the seed that was creating it. That needs its own answer.
