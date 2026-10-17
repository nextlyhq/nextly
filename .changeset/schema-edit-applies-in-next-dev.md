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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

Saving `nextly.config.ts` during `next dev` applies the new schema again, without a restart, under Turbopack and webpack and on any port. The dev reload used to wait for a message on Next.js's HMR socket, which Next.js 16.3 and later serve at a different path, so no edit was applied until the server restarted. Nextly now watches the config and every file it imports, by directory so an editor's rename-on-save is seen, and only under `next dev`.

When a saved config can't be read, the dev log now says why: the syntax error and where it is, an import that can't be found, or `esbuild` missing. The previous config stays in place either way. `NEXTLY_HMR_URL_OVERRIDE` no longer does anything, because there is no socket to point; `NEXTLY_DISABLE_HMR=1` still turns the dev reload off.
