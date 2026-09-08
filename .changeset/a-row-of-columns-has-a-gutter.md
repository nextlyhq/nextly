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

A row of columns laid out a grid and left the gutter at zero, so the one block whose
whole purpose is side-by-side content rendered its columns touching. Measured on a
published page: three tracks of 427px with nothing between them. It now has a gutter,
`1rem` — the same amount `core/gallery` and `core/accordion` already space their
children by, so three grid containers do not space their children three different ways.

The value is a length rather than the `space.4` token it names, and that is a
deliberate limit rather than an oversight. A consumer with no write path compiles the
stylesheet once, stores it, and hands it back; on that path `PageRenderer` states no
breakpoints and emits no site sheet, so nothing defines `--site-*` while the stored CSS
still references it. A token gutter arrives as a `var()` with nothing behind it, which
is invalid at computed-value time, and the gap falls back to zero — the exact defect
this change exists to fix. A test now fails if the gutter becomes a token before that
path defines what it references.

A page's stored content is untouched, and an author who set their own gap still wins,
since authored styles outrank a block default.
