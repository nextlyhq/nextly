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

IndexNow's key file is served without the Proxy: `withNextly()` rewrites `/<key>.txt` to the SEO plugin, and switching IndexNow on in Settings › Connections first reads the key file at the site's production address, staying off with a "Check again" where Bing couldn't read it. A `202` from IndexNow is shown as accepted only once the key file answers, and as a refused key where it doesn't. `nextly/runtime` adds `composeProxy`, which puts Nextly's Proxy together with a site's own and passes Next.js's event to both, and `nextlyProxyMatcher`, the one matcher the docs write out. On Vercel the Proxy starts Nextly with one database connection and closes it before its function is suspended, so Proxy instances no longer fill a small database's connections. The SEO plugin's start runs its background work one part at a time, the Proxy is noted as running by every handler, the Overview's checklist gains "Connect the site's Proxy", and plain-text copies can't be switched on before the Proxy has run.
