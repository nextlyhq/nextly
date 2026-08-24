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
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

The preview mount is now validated when configuration is read, rather than when an editor clicks
"Copy shareable link". `preview.route` names where your app mounts `createPreviewRoute`, and a value
that cannot produce a working link — one pointing at another origin, or carrying a query or a
fragment — stops the boot with a message naming the value and the remedy. Previously the first
sign of a bad mount was an editor being refused a link, and the person who can fix it is not the
person looking at that message.

A mount path carrying its own query is refused rather than accepted and mangled. The link's `token`
parameter is appended to this path, so `"/api/preview?tenant=a"` was assigned as a pathname and
handed out as `/api/preview%3Ftenant=a` — a link that reaches no route and carries no token. The
resolved value is also normalised now, so what a link is built from is what the configuration says:
`"/api/preview/"` and `"/api/../preview"` no longer mean one thing where they are read and another
where they are used.
