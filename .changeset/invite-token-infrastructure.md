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

Add the ability to invite a user by a set-password link.

Nextly can now mint a single-use link that lets a new person set their own password and sign in, and accept that link in one step. `AuthService.generateInviteToken(userId)` returns a 256-bit token (only its SHA-256 hash is stored, and only one is active per account at a time); `AuthService.acceptInvite(token, password)` validates it, sets the password, marks the email verified, activates the account and consumes the token, all in one transaction. The link lasts seven days.

A new endpoint, **`POST /auth/accept-invite`**, accepts the link over HTTP: it takes `{ token, newPassword }`, is CSRF-protected like the other auth routes, and answers with one generic message for any unusable token (unknown, used, expired) so a guessed token learns nothing about which invites are live — while a weak-password error is passed through, since that is the one thing the person can fix.

The mechanism is complete and tested at both the service and HTTP layers. What is not here yet: creating a user through the admin does not mint one of these links automatically — that wiring, and the form that shows the copyable link, come next.

`users.password_hash` is now **nullable on Postgres**, matching SQLite and MySQL, so an invited account can exist before it has a password. This is a schema change your next `nextly db:sync` will apply; loosening a NOT NULL constraint is not data-losing, so it applies cleanly.
