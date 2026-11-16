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

An image binding's Fallback in the page builder can now be chosen from the media library. A button at the end of the Fallback row opens a picker with the newest images and a search by name, moved through with the arrow keys, with "Browse all…" for the full library dialog and "Use this address" for a pasted image address. A chosen image is shown by its picture and file name rather than its id, and the canvas's "Visitors won't see this" badge and the inspector's note name it the same way.

`useMediaSearcher` is new in `@nextlyhq/plugin-sdk/admin` and `@experimental`: it searches the media library's images by name, the newest twelve for an empty search, through the library's own list read. The page builder's `ContentServices` gains an `@experimental` `searchMedia`, and `VisitorUnreadableBinding` from `@nextlyhq/blocks-engine` now says the bound prop's `kind` where the block's props are known.
