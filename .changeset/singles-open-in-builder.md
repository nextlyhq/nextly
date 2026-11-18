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

A Single whose main field is the page builder, such as a Homepage with a title and a page layout, now opens straight in the Page Builder from the sidebar, the Content screen, the dashboard and every other link that opens it, as a page does. "Open as form" in the builder's ⋯ menu reaches its form, which offers "Open in builder" beside History, and the builder's back arrow reads "Back to content". A Single whose main field is anything else keeps opening as a form, and so does one opened by a reader who may only read it. To keep a Single in its form, set `admin: { opensIn: "form" }` on it; a Single's `opensIn` naming a view it can't open in stops the start, as a collection's does.
