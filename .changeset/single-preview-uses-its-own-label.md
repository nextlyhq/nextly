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
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
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
---

A Single's preview pane is now called by the name the Single declares, instead
of always saying "Preview". A collection's preview has always honoured
`admin.preview.label`; a Single's ignored it.

The server was already sending it. A preview declaration's `url` is a FUNCTION
and cannot survive being stored as JSON, so it never reaches the browser — but
the label beside it is a string and does. What was missing is that the admin's
own type for a Single never declared the field, so nothing read it.

Two duplications are collapsed rather than extended. The default is derived in
one place now, shared by entries and Singles, so a second `?? "Preview"` cannot
keep the fallback after someone changes the real one. And a Single's schema
carried its own inline copy of the admin options, which had already drifted —
it was missing `order` and `sidebarGroup`, both of which the server sends. It
references the shared declaration instead, which is what made the label
invisible to the editor in the first place.
