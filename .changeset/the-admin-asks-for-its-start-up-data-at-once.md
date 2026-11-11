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

A fresh admin tab now asks for what every screen needs in one request, and sends it before anything else.

**How it works.** The admin sends `GET /admin/api/startup?path=…` with up to 16 of its own read paths: the session, setup status, admin metadata, the workspace, the person and their permissions and capabilities, General settings, and the menu's collections and Singles. The server answers each part exactly as a request to that path would. Each part goes through the same security checks, rate limits, route and permission checks, and comes back with its own status, so a part the person may not read keeps its own refusal. The screens take their data from that answer instead of each asking on its own, so a fresh tab waits through fewer round trips before it has data.

**Fewer reads of an entry.** An entry's edit page now waits for its collection's schema before reading the entry, so it reads the entry twice instead of four times.

**Other callers.** The separate endpoints are unchanged.
