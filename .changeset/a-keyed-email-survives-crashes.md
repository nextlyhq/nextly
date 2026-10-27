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

A keyed send now holds up through crashes, slow providers and partial failures.
A send that reached some recipients and not others reports each recipient's
outcome (`partlyDelivered`, `recipients`), and a retry with the same key sends
only to those not yet accepted, whichever provider carries it. Every provider
call has a 2-minute deadline and a cancellation signal; a call that has not
answered by then is reported as unknown and retryable, and its claim stays held
for up to 10 minutes while the call may still answer. A failure whose delivery
cannot be known carries `unknown: true`. A keyed send's delivery records and
its outcome are committed together. Sends whose recipients all fare alike
return the result they always did.
