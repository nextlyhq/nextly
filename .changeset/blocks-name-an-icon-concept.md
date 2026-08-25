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
"create-nextly-app": patch
"nextly": patch
---

Blocks carry an icon, and the palette and layers tree draw it.

`BlockEditorMeta.icon` was declared and never used: no block named one and no
surface drew one, because nothing said what the string should contain. It now
names a concept from `BLOCK_ICONS` — `"columns"`, `"quote"`, `"loop"` — and all
nineteen core blocks declare one.

The vocabulary is concepts rather than the names of an icon library's exports.
The editor draws with `lucide-react`, which is a peer dependency admitting any
`>=0.400.0`, so naming its exports in the block contract would let a host's
choice of release break a plugin block whose author did nothing wrong, and would
freeze the editor's art direction into every block definition ever written. One
file decides what each concept looks like, so the editor can re-skin without a
block file changing.

A block that names no icon, or names one this editor has never heard of, draws a
generic mark rather than nothing. An editor cannot tell a plugin author's typo
from a concept a newer engine added, and a row with no mark is a different shape
from every row beside it.
