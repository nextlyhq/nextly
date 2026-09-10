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

A write records what kind of caller made it.

An API-key write, an import, a job write and a bulk edit recorded nothing in
the activity trail — not mislabelled, absent. The recorder refused any actor
that was not a signed-in person, because a row's identity column is joined to
the accounts table and a key's own id would find no account and be filed as an
already-erased person.

The row now carries the KIND of caller that column refers to, so each is
recorded as itself. `user_id` is unchanged and still required: it is already
documented as the actor's opaque reference, so one nullable `actor_type` is the
whole schema change and no dialect needs a nullability rebuild.

A NULL kind means a row written before this existed. Those are all user writes,
because no other kind was recordable.
