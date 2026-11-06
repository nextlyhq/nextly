---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
---

Move a pattern, a component or a Layout between sites as one file. Each row of
the Components, Patterns and Layouts lists offers "Export", and "Import from
file" above each list brings a file in after a preview. API clients use
`POST /transfer/<components|patterns|layouts>/:id/export` and
`POST /transfer/import` (with `dryRun: true` for the preview).

The file holds the item and everything it depends on: the components it places
(and the ones those place), the shared styles and variables its styles use, the
breakpoints its styles and per-device hide settings name, and the images it
shows, with their bytes. It lists the block types it uses but never carries a
block's code, and it never carries the site's default Layout mark.

An import shows what it adds, what is already here and reused (an identical
image, shared style or variable), and what clashes by name. Each clash is added
under a new name by default, or can use the existing item instead; nothing on
the site is ever overwritten. A breakpoint maps only to one of exactly the same
width; one with no match is added (by someone who may manage site settings) or
has its styles dropped. A file using a block the site lacks, making a component
loop or breaking a lock is refused before anything is written, and an import
whose site changed since its preview asks for a new one.
