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

Locked, unverified and deactivated accounts could still receive a session.
Only the password strategy checked account state, and `issueSession` trusted
whichever caller reached it, so any other strategy minted a session for an
account the password path would have refused. Three handlers re-checked
`isActive` on their own, and a path that forgot simply issued the session.

One gate now decides whether an account may hold a session, and every path that
ends in one asks it: password login, challenge resolution, the forced
first-sign-in password change, refresh, and the plugin path that follows. Each
refusal carries the same public error, so the gate cannot be used to tell a
locked account from an unknown one.

A refresh whose account is no longer usable now deletes the refresh row and
clears the cookies rather than answering 401 and leaving both alive, so an
account deactivated mid-session loses it at the next rotation. The password
attempt lockout applies to password logins only: a refresh is not a password
attempt, and someone else guessing a password must not end a session that is
already established.
