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

A site can now edit a block type's own look, such as a button's Primary, and
the edit reaches every block of that type. The edit is stored as a look in the
site's class library, marked `isDefault`, and laid over the block's base
styles property by property, so every default value the site didn't change is
kept. A look, a shared style and the block's own values still win over it, and
under the Classic spacing model it sits over the frozen base.

Each core block with looks now has its own look in the code tier with no edits,
so a site stores it only once it changes it. An own look is never written as a
class, so no block can wear it or refer to it. A block variation that is its
block's own look and also states styles is no longer read as a look.

Published pages and the canvas read the same edits, because the renderer reads
them from the class library it already receives. Nothing to migrate: stored
libraries without own looks compile byte for byte as before.
