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

Stop the colour picker saving a colour you did not finish typing.

Typing a hex colour used to save on every keystroke. Because a prefix of a
valid colour is itself a valid colour — `#123456` passes through `#123` and
`#1234` — stopping partway left the last of those saved. Typing `#123456` and
pausing at `#12345` stored `#11223344`, a colour nobody typed, replacing what
was there.

A typed colour is now saved when you finish it: press Enter, or leave the
field. Dragging on the surface and the sliders is unchanged and still updates
as you move. Dismissing the picker mid-word discards the unfinished text and
leaves your stored colour alone.
