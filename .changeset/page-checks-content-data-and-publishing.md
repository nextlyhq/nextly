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

Page checks now lists what would make the live page wrong or empty, under Content and data and Publishing.

- **Content and data** always starts with the page's data, "Page data: 12 of 500". Over the limit, each block that then shows empty is listed, with what it misses. The top bar still shows the count only once a page nears the limit.
- **Content and data** also lists the page's bindings that no longer fit, as "Bindings to fix" names them, and a page that shows two headers (or footers): its header & footer set's and one of its own. Choosing that item selects the page's own block, even after the notice above the canvas is dismissed.
- **Content and data** lists blocks left empty: an Image with no picture, a Button with no link, and a Collection list with no source. Each opens the setting that fills it.
- **Publishing** lists each component the page uses that isn't published, and its header & footer set when that isn't. It's asked again after each save and each pause in editing.

For scripts, `runPageChecks` reads these from a new optional `facts` (`PageFacts`) on the page you pass. A check may add a line under its group, which arrives in `report.notes`. Both are `@experimental` in `@nextlyhq/builder`.
