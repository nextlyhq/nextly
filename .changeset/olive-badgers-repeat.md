---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
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

Run collection and single `beforeChange` hooks after validation, not before

A `beforeChange` handler declared on a collection or single used to be
registered onto the `beforeCreate`/`beforeUpdate` queue, which fires before the
schema rules are enforced. The phase documented as the last chance to shape a
stored value therefore ran on data that had not been validated, and it ran even
for writes that were about to be rejected. The field-level hook of the same name
was already in the right place, so the two `beforeChange`s meant different
moments.

`beforeChange` is now its own phase, executed immediately after the validation
gate on every write path: collection create and update, both of their
transactional forms, the transactional single paths, and the single update
service.

This changes when existing handlers run. A `beforeChange` that SUPPLIES a value
the schema requires now runs too late to satisfy it, because validation has
already been applied; move that work to `beforeValidate`, which still runs
before the gate. This includes the Schema Builder's pre-built "Auto-generate
Slug" hook when it targets a required field of your own. The framework's own
`slug`/`title` derivation is unaffected: it does not run as a hook.

What a `beforeChange` handler returns is written without being re-validated.
That is the point of the phase, and it is now true rather than accidental.
