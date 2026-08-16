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
---

The page editor now decides whether it fits by measuring the space it was actually given, rather than the size of the browser window. Embedded as a field inside a form on a wide screen, it used to conclude it had room and squeeze the rail, panel and canvas below the widths they need; it now shows the "needs a wider screen" message in that case, and goes back to the full layout as soon as the space grows again.

The media picker also no longer floats over that message. It opens in a layer outside the editor, so hiding the editor left an open picker visible and clickable on top of the notice saying the editor was unavailable.
