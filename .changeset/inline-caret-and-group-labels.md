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

Place the caret where an author clicked, in a passage the editor restyles.

Opening an inline edit replaces the passage's markup and applies the editor's own theme, so a heading's size, a list's indentation and a table's box can all change the moment editing begins. The click position was being measured after that, against a layout nobody had seen — so in any passage whose appearance changes, the caret could land on an unrelated character or at the end. It is measured now at the last moment the page still shows what the author clicked.

A page description also includes the labels on a button group. Every one is drawn on the page, and each is stored in a place the walk that flattens a passage to plain text never read, so a passage offering "Basic" and "Pro" described the page without them. Read in the shared walk, so search indexing and the crawler description agree.
