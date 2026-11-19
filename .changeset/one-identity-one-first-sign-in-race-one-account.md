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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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

Provisioning an account for a first sign-in is one transaction, and safe under its own race. The identity row the sign-in provisions for is attached inside the user-creation transaction that makes the account and grants its roles, so a creation the identity table refuses leaves nothing behind: no account the identity will never resolve to, no role grants dangling off it. Two first sign-ins for one identity — both passing the lookup that precedes the creation — are decided by the identity's unique index: exactly one account and one identity result, and the loser's sign-in resolves to the winner's account rather than surfacing the database's refusal. Where the database instead ends the stand-off itself — MySQL's restart verdict on two creations that meet inside it — the refused creation is restarted once and resolves the same way. An address another account already holds keeps refusing the provisioning outright, as before.
