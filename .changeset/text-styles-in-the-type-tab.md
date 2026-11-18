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

Design → Type gains "Text styles": each row previews sample text in the style beside its size and line height, and "+ Add text style" makes one. A text style can be renamed in place (F2), duplicated, locked and removed from its ⋯ menu; removing one a block or a Site text row uses is refused, saying where, and a locked one can't be changed until it is unlocked.

- A row opens the style's parts: its font (the Body font, the Headings font or one of the site's fonts), its size for Desktop and each of the site's devices (a type size, a typed size or "Fluid…"), line height, weight, letter spacing (in `em` unless another unit is typed) and case ("As typed", "UPPERCASE", "lowercase", "Capitalised"). Every part but the font and case can follow a variable or hold a plain value. Each change saves at once and is a step of the editor's undo.
- Each Site text row but Links can follow a text style ("Heading 1 uses Display"), keeping its own size and line height for when it stops.
- A role that may not change the site's design sees the text styles read-only.
- `TextStylesSection` is exported from `@nextlyhq/builder/shell` (`@experimental`), and the Site text section takes an optional `classes`.
