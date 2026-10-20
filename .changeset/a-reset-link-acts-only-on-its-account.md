---
"nextly": patch
"@nextlyhq/plugin-accounts": patch
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

Password-reset and email-verification links now act only on the account they
were issued for, and only while it still holds the address they were sent to.
Each link records its account (a new `user_id` column on
`password_reset_tokens` and `email_verification_tokens`, with a foreign key to
`users`). Changing an account's address revokes its links, so one sent to the
old address stays dead even after the account moves back. Deleting an account
removes its links, whatever address they went to. Someone later given an
address is never reset or verified by a link sent to an earlier holder.

Issuing a link, following one, changing an address and deleting an account
each hold the account's row for their transaction, so a link issued or
followed while the account moves or is deleted is either revoked afterwards
or refused. Following a link now checks it, applies it and spends it in one
transaction, so two redemptions of one reset link cannot both set a password.

`nextly migrate` adds the column and removes every outstanding password reset
link: a reset link may have been given any lifetime, and its stored times
cannot show reliably when it was issued. It ties each outstanding email
verification link to the account holding its address when that account was
created and last changed before the link was issued, so those links keep
working. A verification link whose account was created or changed at or after the
time it was issued (on MySQL and SQLite, which store whole seconds, also in the
same second) is removed, since it may have been sent to an
earlier holder of the address, and so are expired links and links to an
address no account holds. Their owners request a new link.
