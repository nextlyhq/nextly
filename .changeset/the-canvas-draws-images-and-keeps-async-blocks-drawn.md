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

The page builder's canvas now draws images and keeps them drawn. Blocks that render asynchronously, such as images and buttons, never drew in the editor, which renders the page in the browser: React refuses an async component there. `@nextlyhq/blocks-react` now reads an async block's output with `use()`, which works on the server and in the browser alike. When the editor draws the page again for a selection or an opened panel, a block's output is reused while the block, its class and its stored props are unchanged, so images and buttons no longer blink out. A published page never reuses an output: it renders per request. An image chosen from the media library now resolves on the canvas too, through the admin's own read of a media item, cached by id. `@nextlyhq/admin` adds `useMediaResolver`, built on the same query as `useMediaItem`, and `@nextlyhq/plugin-sdk/admin` exports both, `@experimental`.
