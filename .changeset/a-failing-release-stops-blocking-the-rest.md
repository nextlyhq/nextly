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

A failing scheduled release no longer blocks the healthy ones.

A drain pass always runs its first release group whatever the clock says —
otherwise a budget too small for one would leave a backlog stalled forever. With
a fixed order that guarantee became its own problem: a release whose write fails
holds itself open, is planned first again on the next run, consumes the budget
again, and every healthy release behind it waits indefinitely. Nothing crashes
and every pass reports success, so the symptom is simply that some releases never
go live.

The order now rotates, so every release group reaches the front. One that keeps
failing is still retried — that is the contract — but it no longer starves the
rest while it does.
