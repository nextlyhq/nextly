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

A self-registered account was marked as having a verified email address the
moment it was created. Creating a user with a password set `emailVerified`
straight away, and registration supplies a password, so the verification email
sent afterwards changed nothing: `requireEmailVerification` blocked nobody, and
anything that trusts the verified flag was trusting an address the account
holder had merely typed.

Creating a user now says explicitly whether anything established the address.
An operator who types someone's password vouches for it, as before, and that
path is unchanged. Registration does not, so the account stays unverified until
its verification link is followed. Callers that say nothing get the unverified
account, because a caller that forgets to say is the one whose claim should not
be believed.

Operators upgrading should know that accounts self-registered before this
change carry a verified flag nothing proved. They are not rewritten
automatically — that would sign out anyone relying on it. To review them, look
for users with a password, not created by an admin, whose `emailVerified` is
within a second of `createdAt`.
