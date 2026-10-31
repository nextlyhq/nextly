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

On a site that ships no sample content, the dashboard's setup card now drops its "Start with sample content" step, rather than holding it open as unreadable and asking the server again on every read of the card.

The card asks `HEAD /admin/api/seed` whether this person may load sample content. A site with no sample-content route of its own (the blank template, a plugin's dev app) sent that request to the admin API's catch-all, which answered `400 Invalid REST route format`. The card reads only 401, 403 and 404 as "no", so it took the 400 as "not known", kept the step open as unreadable, and asked again on every read of the card.

- **`nextly`**: the admin API answers `/admin/api/seed` with `404` where the project ships no route of its own there, in the canonical error envelope (no body for a `HEAD`). Every other path the built-in router does not serve still answers `400`. A project's own route, such as the blog template's, is matched first and is unchanged.
- **`@nextlyhq/admin`**: the probe reads any other 4xx (except 408 and 429, which may not hold on the next ask) as "no sample content", noted once at debug level, so a site running an older `nextly` stops re-asking too.
