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
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/storage-uploadthing": patch
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

A session token with no `typ` header no longer verifies. This is the release
the typed tokens change (v0.0.2-alpha.67) named in advance, which was to ship
at least 30 days after it and no sooner than an unmarked token could have
expired — the longest-lived unmarked token, a Direct API token from
`nextly.login()`, lives 30 days. It **breaks Direct API tokens minted before
the typed tokens change**: a token taken from `nextly.login()` before that
upgrade stops working wherever a session is read, and the caller mints a new
one after upgrading. Tokens that carry the header, browser sessions (access
tokens rotate every fifteen minutes), and the pending tokens of a
second-factor exchange are unaffected.
