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

Fix the scaffold job's workspace-package pin, and fail closed on an unreadable
search-index manifest.

The pin rewrites dependency specifiers after the scaffold has generated its
lockfile, and pnpm turns frozen-lockfile on by default in CI — so the pnpm blog
leg aborted with ERR_PNPM_OUTDATED_LOCKFILE before it could build.

An index manifest that exists but cannot be parsed no longer reads as owning
nothing. writeFileSync is not atomic, so an interrupted build can truncate it,
and treating that as an empty ownership list left the previous index in place
while the status flipped to empty — the search page would load and serve
unpublished results.
