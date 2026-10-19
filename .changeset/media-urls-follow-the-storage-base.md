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

Media stored on local disk now shows on any host and port. Reads return a medium's URL, its variants' URLs and media reached through a relationship or a Single as the storage wrote them: the local adapter's `baseUrl` followed by the file's path, `/uploads/...` by default. They used to be rewritten onto `NEXT_PUBLIC_APP_URL`, which a new project sets to `http://localhost:3000`, so images broke on any other port, a LAN or tunnel address, and preview deployments. To serve uploads from another origin, give `localStorage()` an absolute `baseUrl`. S3, Vercel Blob and UploadThing URLs are unchanged.

- **If your code relied on an absolute local URL** (an email, a feed, JSON-LD, an app on another origin reading the API), make it absolute with the new, experimental `toPublicMediaUrl(url, { baseUrl })` from `nextly`. It resolves against the `baseUrl` you pass, else `NEXT_PUBLIC_APP_URL`. With neither set, development warns and returns the path, and production logs an error and returns `null`: it never guesses a host. Or set `localStorage({ baseUrl })` to an absolute URL.
- Open Graph and Twitter images from `buildMetadata` stay relative and resolve against your root layout's `metadataBase`, as canonical links already do. A block page's derived Open Graph image (`@nextlyhq/blocks-react/next`) resolves the same way.
- The blog template's JSON-LD makes its article image absolute on the site's own URL.
