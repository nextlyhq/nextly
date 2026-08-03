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

New apps get development error diagnostics turned on.

An error response is deliberately generic — a code, a public message and a request id — and
withholds the log context and the underlying cause so a response cannot disclose driver output,
table names or internal paths. That is right for a deployed app and unhelpful while building,
where the withheld part is exactly what you need.

`NEXTLY_DEV_DIAGNOSTICS=1` adds a `_devDiagnostics` field carrying that detail. It existed
already, and nothing set it or documented it, so an author hitting an error had no reason to
suspect a flag would have named the cause. `create-nextly-app` now writes it into `.env` and
`.env.example`, and `docs/configuration/environment.mdx` describes it with a worked example.

It cannot expose anything in production: the gate requires `NODE_ENV` to be `development` **and**
the flag to be `1`. One signal is not enough, because `nextly` ships pre-built and stays external
to your build, so `NODE_ENV` is a runtime value a production deployment can carry by mistake.
