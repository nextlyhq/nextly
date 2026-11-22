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

Core keeps each external identity a login provider asserts in its own table: the provider key, the issuer that asserted it where the provider has one, the subject, the address last asserted, and the account that owns the row — and no provider token of any kind. Each identity is unique by a plain SHA-256 digest of its provider key, issuer and subject, held as one indexed column and enforced identically on PostgreSQL, MySQL and SQLite — no collation can fold case or pad a space away where the thing compared is a digest, and no column width can refuse a long issuer or subject, since the key's columns themselves are unbounded text everywhere. An issuerless provider's rows carry an empty issuer, so "no issuer" has one spelling and every writer derives the same digest; one subject from two issuers of one key is two identities. A deleted account's identities go with it, in the deletion's own transaction.
