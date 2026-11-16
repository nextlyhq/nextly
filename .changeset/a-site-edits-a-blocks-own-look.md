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

A site's edit of a block type's own look, such as a button's Primary, now
reaches every block of that type. The edit is stored as a look in the site's
class library, marked `isDefault`, and laid over the block's base styles
property by property, so every default value the site didn't change is kept. A
look, a shared style and the block's own values still win over it, and under
the Classic spacing model it sits over the frozen base. The page builder does
not offer a control that edits it yet.

`blockOwnLooks()` gives each block's own look with no edits, and the plugin
seeds them in the code tier, so a site stores one only once it changes it.
`blockLooks()` still gives only the looks a block can wear. An own look is
never written as a class, so no block can wear it or refer to it. A variation
that is its block's own look and also states styles is no longer read as a
look.

Published pages and the canvas read the same edits, from the class library they
already receive. A route that states classes of its own keeps them, with the
site's own looks carried in. `overlaidStyles()`, the layering the editor uses
for Detach, now lives in the engine and also lays an own look over its base.
A second own look for one block type is reported (`duplicate-own-look`) instead
of being ignored silently, and a stored shared style may share an own look's
name. Own looks are read under an allowance of their own, so seeding
them never pushes a worn look past the look cap, and a block's own look is kept
whatever its variation is named.

An own look stays with its site. A page builder export never carries one, and
an import leaves out any a file holds, so importing an item never changes the
target site's own looks. The item draws with them instead.

Nothing to migrate: stored libraries without own looks compile byte for byte as
before.
