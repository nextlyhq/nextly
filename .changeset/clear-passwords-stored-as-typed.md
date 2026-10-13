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
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
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
---

New command: `nextly users:clear-plaintext-passwords`. Earlier releases stored some
passwords as typed instead of hashing them (32 characters or more containing a colon,
given when an account was created, or any value sent to `PATCH /api/users/:id/password`).
Such a value never let anyone sign in, but it is readable in the database and its backups.

Run the command once the upgraded version serves every instance, since an old instance
can still store a password as typed. Without flags it only counts the affected accounts;
with `--apply --confirm-default-hasher` it clears each stored value and ends that account's
sessions, printing only a count: none can be renewed, and an access token already issued
lasts until it expires, within fifteen minutes by default. `--apply` alone changes nothing: the second flag is your
statement that no stored password was written by a custom `passwordHasher`, now or earlier,
since the command cannot see one and would take its hashes for plain text. Values in a format other
hashers write (an argon2, scrypt or pbkdf2 string in the modular-crypt form their libraries
write, or a hex salt and digest joined by a colon) are never counted or cleared; a value that
only starts with `$` is. `nextly migrate` now prints the same count and names the command, and changes
nothing itself. People whose password was cleared are refused at sign-in exactly as
before, and set a new password with Forgot password, or an administrator sets one.
