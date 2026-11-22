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

A size in Design can now be made fluid from two numbers instead of a
hand-written `clamp()`. "Fluid…" under a size, and under a type size's size,
asks for "On small screens" and "On large screens", and says what they make:
"16px at 360px, growing to 20px at 1280px". "Make fluid" stores a size that
grows evenly across that range and stays at each end outside it. The value
is written in rem, so it follows the reader's text size.

A value written by hand opens on its nearest two sizes, and making it fluid
converts it.

The two sizes are kept beside the value, in a new optional `fluid` field on
a site token (`{ small, large }` in px). A save validates the field and keeps
it, so the size can be made again from its two sizes. Typing a light value
by hand drops them, which makes the value hand-written again.

`lengthInPx` now lives in `fluid-size.ts`, and `style-variables.ts`
re-exports it, so no import cycle forms.
