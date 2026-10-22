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

A send can now carry an `idempotencyKey`, and the email then goes out once on
every provider: on `nextly.email.send` and `sendWithTemplate`, the same two on a
plugin's `ctx.services.email`. A repeat of a send
that succeeded returns its result with `repeat: true` and sends nothing; a
repeat after a failure sends again; the same key with a different message is
refused. Keys are scoped to their caller, so two plugins never share one, and
Resend is also handed a key derived from the caller's.

Nextly stores a keyed digest of each key in a new `email_send_claims` table and
a new `key_digest` column of `email_deliveries`, never the key or an address,
and erasing a person clears the digest from every record of their sends.
`nextly migrate` and boot add both on all three databases, and rewrite no row.
Sends without a key are unchanged.
