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

The editor can compile a page for a preview surface that is not the browser window.

A responsive breakpoint says "apply below this width" and asks the browser window. An editor that
shows the page inside a resizable box shares that window, so narrowing the box changes nothing about
which rules apply — the block gets narrower and keeps its widest styling. This adds an option that
emits those breakpoints against the box instead, so a preview shows what the page will actually look
like at that width.

Published pages are untouched. The option is off unless a caller asks for it, so a page's compiled
stylesheet and its cached identity are byte-for-byte what they were.

Breakpoints that respond to a block's own container are deliberately not previewable this way, and
are emitted so that they match nothing rather than matching the preview box — a container breakpoint
depends on where the block sits, and showing it against the surrounding editor would be wrong in a
way that looks right.
