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
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

point the builder dev watchers at `src`, so `pnpm dev` rebuilds again

`tsup --watch` defaults to watching `.`, and at that root it never notices an
edit: no `Change detected`, no rebuild, and an artifact byte-identical
afterwards. Measured back to back on tsup 8.5.0 — `--watch .` saw nothing,
`--watch src` detected the same edit and rebuilt it.

Nothing errored while it was broken, which is why it survived: the watcher logs
a successful initial build and then `Watching for changes`, and the only symptom
is the ABSENCE of a later build line in output that scrolls. Anyone debugging a
stale `dist` was debugging code that had never been rebuilt.
