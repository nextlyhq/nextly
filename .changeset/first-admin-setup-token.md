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
---

**In production, creating the first administrator needs a one-time setup token.**
Until an install has an administrator, whoever reached `/admin/setup` first
could create one. Now, in production, setup asks for a token:

- **Generated:** a production start on an install with no administrator prints
  one line beginning `[nextly] SETUP TOKEN`, with the token and the setup
  address. It is valid for 24 hours and for one setup, and only its digest is
  stored.
- **Your own:** set `NEXTLY_SETUP_TOKEN` (at least 43 characters, 16 of them
  distinct). `nextly setup-token --generate` prints a suitable value. A weaker
  value keeps setup closed, and the start says so.
- **Replace it:** `nextly setup-token`, run against the install's database,
  replaces the generated token and prints the new one.

The admin's setup form asks for the token when it is needed. A valid token
completes setup whatever the sign-in rate limit holds, and wrong ones count
against it. Setups racing with the token create exactly one administrator.
Development is unchanged.

Upgrading: an empty production install needs the token on its next start (the
log line and the setup form say where it is). Automation that creates the first
administrator over HTTP in production sets `NEXTLY_SETUP_TOKEN`. Installs that
already have an administrator see no change. No migration is needed.

`nextly_meta`'s compare-and-set now works on MySQL. It never matched a stored
value there, so every claim built on it was refused.
