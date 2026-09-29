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

The sign-in screen used to boot in three lines: ask whether the installation
was set up, then — only after that answered — ask whether the visitor already
held a session, then — only after the form finally mounted — ask the settings
endpoint for a timezone the form never renders. Each ask is a full API
round-trip, and on a hosted admin each round-trip is a third of a second or
more, so the blank screen a visitor stared at was mostly the app waiting for
answers it did not need in that order.

The two guard checks are independent and now run together; the settings sync
only mounts behind the private routes that render dates, so the signed-out
screens stop requesting an endpoint their session can only fail against (and
retry once). And the development-only reload stream, which every published
bundle opened against a route that only exists in development — reconnecting
on the host's bill forever — no longer compiles in: the library build now
pins `NODE_ENV` itself, defaulting an unset environment to production, which
is how every release build runs.
