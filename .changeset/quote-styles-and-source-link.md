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

A Quote's source is the shared link every block uses (an address or an entry, a new
tab, a relationship): it is the quotation's `cite` and links the source's title on
the live page. The dash before the person's name is drawn in CSS, not stored in the
words. A Quote has three block styles, Line (its own: a line in the site's accent
colour), Plain and Large, the same on the canvas and the live page. Its stored shape
is version 2: a Quote saved before is upgraded when it is read, its source address
moved to the link's address, on a page or inside a component, together with a field
bound to it. A migration step may now rename props (`renames`), and a value bound to
a renamed prop moves with it, and so does a component's exposure of it. The page
builder opens a page with every block at its current version, so an edit saves the
block upgraded, and opening a page alone marks nothing as changed; a locked block
saved upgraded is not read as changed. Existing Quotes now draw the Line style and
link their source's title.
