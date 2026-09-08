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
"@nextlyhq/plugin-form-builder": patch
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

Raise the mysql2 floor to 3.23.1, closing two advisories that reach published
installs.

`@nextlyhq/adapter-mysql` declares mysql2 as a runtime dependency, so the range
it publishes is the one a consumer resolves. 3.15.0 accepts an auth-plugin
downgrade to `mysql_clear_password`, which sends the connection password to the
server in plaintext, and carries an unbounded zlib inflate in the compressed
protocol handler that lets a malicious server answer with a decompression bomb.
The first is patched in 3.22.0 and the second in 3.23.1.

A dependency bump alone would not have reached anyone: the published range only
changes for a consumer when the package is released, and nothing here is
released without a changeset.
