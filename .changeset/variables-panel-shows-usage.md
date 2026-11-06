---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
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

The Variables panel in the page builder now shows how widely each variable is used. Every row ends in the number of places that use it: pages, components and other documents, shared styles, and block types whose default style names it. Zero is muted, and a number followed by "+" means some pages are not counted yet. Hovering the number, or a screen reader, says it in words.

A variable’s editor says beside Remove how widely it is used. Removing a variable that is still in use now explains why it can’t be removed right there: the places that use it, with each page or component a link that opens it in a new tab, each shared style named with what it sets (such as text colour) and opening in Design > Shared styles, each block default style named, and Show all for the rest. While some pages are not counted yet, it says the variable may still be in use and offers Count now where you may count them, or points to how the site’s background jobs run. A variable nothing uses is removed after the same confirm as before.
