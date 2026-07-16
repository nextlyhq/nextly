---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

Invite a user by a set-password link when creating them in the admin.

Creating a user now asks one question up front — **how should this person sign in?** Choose **Send a set-password link** (the default) and the account is created without a password; the admin gets back a copyable link that lets the new person set their own password and sign in. Choose **Set a password now** and the admin sets it directly, as before. The old "Require email verification" checkbox is gone: whether an account can sign in no longer depends on email being configured or a message being delivered.

Under the hood, `createLocalUser` with no password creates the account and mints its invite link in the same transaction, so an admin can never be handed a user with no way in. The link is the artifact — it is returned to the admin to deliver however they choose (email, chat, in person); nothing about creating a user depends on a mail provider. Accepting the link sets the password, verifies the email and activates the account in one step, at the new **`/admin/accept-invite`** page.

Because the account is verified by the act of accepting an invite that reached its address, the create flow no longer pre-checks whether a verification email could be sent — that check, a stopgap that refused to create a user when no mail provider was configured, is removed. Installs with no email set up can now invite users normally.
