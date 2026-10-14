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

Plugins can make opaque secrets and one-purpose secrets with core's helpers, `ctx.security.opaque` and `ctx.security.secrets` (experimental, from `@nextlyhq/plugin-sdk`), for the people a plugin signs in itself.

`ctx.security.opaque` makes random secrets a plugin stores only as a hash, such as its own session tokens: 32 random bytes by default and at most 1024, base64url, with a SHA-256 hash that stays the same across restarts and when the install's secret rotates, and a comparison whose time depends only on the two lengths.

`ctx.security.secrets` mints and spends a long token for a link (1 minute to 30 days) or a short code a person types (6 to 8 digits, 1 to 60 minutes, 1 to 10 wrong tries), each for one purpose and one subject, kept within the plugin that minted it. Secrets are stored only as an HMAC under a key derived from the install's secret, and one minted under the previous secret still works while that secret is configured for reading. Spending is one conditional write in the database, so exactly one of two spends succeeds on every instance, and a code's wrong tries are counted the same way. A new code voids the earlier one. Mints, spends and voids run in the plugin's own transaction when passed `{ tx }`, and otherwise in one of their own, refused when the calling flow already has a transaction open; `consumeCode` never joins a transaction, so a rollback cannot give a wrong try back.

The secrets live in a new core table, `nextly_one_time_secrets`, which `nextly migrate` adds to an existing database as it reconciles core's schema. A secret is removed a day after it expires, by the retention pass that writes offer and by the scheduled drain, so an install that only mints secrets still sweeps them. A subject's secrets are compared exactly on every database, case and spaces included. A subject must be well-formed Unicode, `data` must be a plain object, and `peekToken` reads through the plugin's transaction when given `{ tx }`.

`PluginSecurityApi` gains the members `opaque` and `secrets`. A plugin receives its context from core and needs no change; a `security` member built by hand, such as in a test double, adds them.
