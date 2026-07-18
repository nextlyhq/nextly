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

Force a first-sign-in password change when an admin sets a user's password.

When an admin creates a user by typing a password for them (rather than sending a set-password link), that password is now temporary: the person must replace it the first time they sign in, and the admin-set password stops working once they do. This is the standard treatment for an admin-chosen credential (ASVS 6.4.1) — it keeps the temporary password from becoming the account's long-term one.

How it works: signing in with such an account issues **no session**. Instead the login response asks for a new password, and the admin gets there through a "Set a new password" step shown right in the sign-in flow. Only after the new password is set is a real session issued — so the temporary password can never be used to do anything except set the replacement. A single-use, short-lived token carries the step; it authorizes nothing else.

The forced change is cleared automatically whenever the person sets their own password — by completing this step, by changing their password later, or by using a reset link — so it never fires twice. Accounts created by self-registration, by the initial setup flow, or through an invite link are unaffected: those passwords are the person's own choice.

Additive schema change: a nullable `must_change_password` column on `users`, applied cleanly by your next `nextly db:sync` (no default on existing rows, so nothing is rewritten).
