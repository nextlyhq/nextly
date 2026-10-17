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

An app whose auth rate limit cannot read client addresses now says so. Starting
on Vercel with `security.trustProxy` unset logs a warning that names the
setting: Vercel's edge overwrites `x-forwarded-for` with the client's own
address, so `security.trustProxy: true` makes client addresses resolvable there,
and without it sign-in is limited per named account under a shared ceiling
rather than per client.

The first auth request that arrives with proxy client-address headers but
still resolves no address, because `security.trustProxy` is unset or every hop
it names is a trusted proxy, logs one warning for the process, naming
`security.trustProxy` and `TRUSTED_PROXY_IPS`. A request whose address
resolves, one that carries no proxy header, and any request while the limiter
is off (a budget of 0) log nothing.
