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

An account's external identities are listed and unlinked through core's own doors. The listing answers every row the account owns, in the order the links were made, and nothing else — no other account's identities, and no provider token, because the table holds none. The unlink removes the one link row it names and nothing else: no session is issued and no token is touched, and an identity another account holds is refused exactly as a missing one is, so a caller learns nothing about whose row an id names. REST serves both under the users resource — `GET /api/users/:id/identities` and `DELETE /api/users/:id/identities/:identityId` — gated with the user read and the user update the other per-user management routes take; the Direct API serves them as `users.listIdentities` and `users.unlinkIdentity`, checked the same way. A signed-in person manages their own at `GET /api/me/identities` and `DELETE /api/me/identities/:identityId` with no permission, and a checked Direct API call naming its own account is treated the same. An unlink that would leave a password-less account with no other identity at an enabled provider is refused, checked and removed under the account's row lock so two unlinks at once cannot together remove the last way in, and a cookie-authenticated identity write from another origin is refused as `CSRF_FAILED`.
