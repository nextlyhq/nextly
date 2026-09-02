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

The bound the public byte route reads under only ever grows now, because
each of its inputs is unreliable in a different direction. A row written
before the stored size was taken from the validated bytes can understate
what it points at, and an installation that lowers `security.limits.fileSize`
moves the configured cap below objects it accepted earlier. With both true at
once, every number derived from present state sits under the real object and a
font stored legitimately stops being served, permanently.

Keeping the route's long-standing default as a floor is what closes that: it
is not derived from present state, so no configuration change and no
mis-recorded row can push the bound below what was servable before.
