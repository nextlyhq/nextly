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
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
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
"create-nextly-app": patch
"nextly": patch
---

Erasing someone now reaches their queued email (`@experimental` with the
queued send). Deleting a staff user, or a plugin reporting one of its people
deleted, cancels every queued email that names them and clears its message, in
the deletion's own transaction; erasing an address does the same for queued
email to it that names nobody. An email queued for someone already deleted is
stored cancelled and never sent, whichever of the two commits first. An
attempt already with the provider is left to finish, and its delivery record
is written erased.

Held messages are sealed again under the current `NEXTLY_SECRET` when the app
starts after a rotation, while `NEXTLY_SECRET_PREVIOUS` can still open them, so
a queued email stays deliverable across any number of rotations; the server
log says how many no configured secret can open.

A queued email now records the person it names, and a new
`email_queue_recipients` table keeps a keyed digest of each recipient, never
the address, so an erased address can be found. `nextly migrate` and boot add
both on all three databases.
