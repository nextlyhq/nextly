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

A text style the site's code supplies (`pageBuilder({ siteStyle: { classes } })`) whose sizes were made with "Fluid…" now follows the site's fluid range, on the editor's canvas and on published pages, as a text style made in the editor already does. The size is worked out again from its two sizes each time the site style is read, and nothing is stored: changing the range writes no copy of the code's style, and a later save of the text style list stores no override of it, so the code can still change it. A locked code style follows the range too, since the lock guards the site's own edits and nothing stored moves; the range change is not refused. A code size typed by hand beside its two sizes, rather than the size they make across the code's range, is left as the code wrote it. Sites whose fluid range is the code's see no change.

One case does not follow yet: removing a breakpoint that a code fluid text style holds values at, on a site whose range differs from the code's, stores an override that keeps its other sizes as they are, so that style stops following later range changes.
