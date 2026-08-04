---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
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
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

New apps document the development error-diagnostics opt-in.

An error response is deliberately generic — a code, a public message and a request id — and
withholds the log context and the underlying cause so a response cannot disclose driver output,
table names or internal paths. That is right for a deployed app and unhelpful while building,
where the withheld part is exactly what you need.

`NEXTLY_DEV_DIAGNOSTICS=1` adds a `_devDiagnostics` field carrying that detail. It existed
already, and nothing mentioned it, so an author hitting an error had no reason to suspect a flag
would have named the cause. `create-nextly-app` now writes it into `.env` and `.env.example`
**commented out, with an explanation**, and `docs/configuration/environment.mdx` describes it with
a worked example.

It is documented rather than enabled: the flag is the second of two independent signals, and the
second exists because `NODE_ENV` is a runtime value a deployment can carry by mistake. A default
shipped in `.env` would be true in exactly that case — the one it guards against.

Installing into an existing project that already has a configured `.env` adds the note too, keyed
on its own absence rather than on `DATABASE_URL`.
