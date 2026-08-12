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
"@nextlyhq/builder": patch
---

Erase a recipient from the email delivery log.

Deleting a user left their delivery rows behind carrying a keyed hash of their
address, which an install holds the key for, so the table went on answering
"was this person written to, and when" for an account that no longer exists.
`eraseRecipientDeliveries` overwrites that hash with a value no address can
produce, keeping the row, its status and its timing so aggregate questions
still have an answer. `deleteUser` calls it inside its existing transaction, so
a failed erasure takes the deletion with it rather than leaving the two out of
step.

The erasure takes an ADDRESS rather than a user id, because most recipients
never had an account: a password reset to an address that never registered, a
CC, a BCC added by a `beforeSend` filter. Those people can ask to be erased too
and no account deletion will ever fire for them, so it is callable directly.

`EmailDeliveryRecord.recipientHash` is now `string | null`, where null means
erased.
