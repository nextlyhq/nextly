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

Staff passwords are judged by length and a common-passwords list, not character classes: at least 8 characters (configurable up to 15 via `auth.minPasswordLength`), refused when on the shipped list of 3,000 common passwords, counting characters rather than code units so short astral strings are refused too. A password longer than the serving digester reads whole — 72 UTF-8 bytes for the default bcrypt — is refused instead of silently truncated, at registration, reset, change, invite acceptance, the forced first-sign-in change, and administrator-set passwords alike. Stored passwords are re-judged by nobody: an account whose password predates the rule still signs in with it. An app supplying its own `PasswordHasher` must declare its reach contract (`reach: number | "unbounded"` or a `validate` function) or the server refuses to start, naming the digester.
