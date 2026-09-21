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

Login audit rows now record which strategy authenticated the attempt, on both
the success and the failure row, and the failure row still names no account.
Previously the trail could say that a login succeeded or failed but not by what
method, which is the first thing worth knowing when a sign-in provider turns
out to be compromised.

The strategy survives a second factor: it is signed into the short-lived
pending token, so the session minted when the challenge is answered records the
method that actually authenticated the person rather than the one that answered
the challenge.

`runStrategyChain` now returns `{ outcome, strategyName }` instead of the
outcome alone. It is exported from `nextly/auth/pipeline`, so an application
calling it directly needs to read `.outcome`.
