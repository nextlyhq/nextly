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

The API Playground's request and response panes can now be resized by dragging
the divider between them, and the width you choose is remembered. Its query
parameters lay themselves out from the width of their own pane rather than the
browser window, so the hints stay readable when the pane is narrow.

On the Code tab, Copy now copies the code you are looking at rather than the
response body, and there is one copy button instead of two. Your choice of
Nextly, fetch or cURL is remembered. Response status, latency and size hold
their place so the panel no longer shifts when a reply arrives, and the
empty-state text is no longer set in a code face.
