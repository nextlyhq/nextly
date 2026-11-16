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

The SEO plugin brings its address record up to date after it is reinstalled on a site where it was uninstalled with `--keep-data`. While it was uninstalled, pages were published, moved and deleted with no record of them, and the first start after the reinstall found the address templates unchanged and skipped the catch-up: a deleted page's address could never be used again, and a page published meanwhile could later have its address taken by another. The plugin's install hook, and its uninstall hook when data is kept, now forget the catch-up's fingerprint, so the first start after the reinstall runs the whole catch-up.

Installing the SEO plugin with `nextly plugins install` now boots the app once to run that hook, as it does for any plugin with an install hook.
