---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
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

A plugin's email to one of its signed-in people can now name them:
`ctx.services.email.send` and `sendWithTemplate` take `person`, by kind and
id. The delivery record of the message keeps the person's kind and id, on the
row of the `to` address, in new `principal_kind` and `principal_id` columns of
`email_deliveries`. A `person` that cannot name one, or names a kind no
running plugin registers, is refused before anything is sent.

`ctx.principals.reportDeleted` now also erases, in the same transaction, the
address digest on every delivery record naming the person, and names them
there by the keyed digest of kind and id in place of the id. Every record
written for the person afterwards, the email telling them their account is
gone included, is written without an address digest, even when it is sent
inside the report's transaction. Records of anyone else at the same address,
a staff user's among them, stay as they were.

Every delivery record is written through one insert, which takes the lock a
deletion report waits on; a test holds any new writer to it. `nextly migrate`
and boot add the columns and their index on all three databases, and rewrite
no row.
