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

Settings can now undo the newest breakpoint removal. The Site tab offers it on the removal's row, saying until when it can be undone, every time Settings opens for 30 days. Undo asks first ("Put Mobile back?"), then puts the breakpoint and its styles back, following the undo to its end as a removal is followed. When it is done it says the breakpoint is back, or lists each page it could not put every value back into and why (set again after the removal, on a block deleted after it, on a page deleted after it), linking the pages that still exist. A refused undo says why in the server's words. A removal's confirmation now says it can be undone from Settings for 30 days. The Site tab's 10-second watch for another tab's removal reads the removals alone (`GET /site/breakpoints/removal`, which now answers them, and the removal that can be undone, when no run is named) instead of all of Settings. An unreadable status at the end of a removal is read again rather than calling the removal route again.
