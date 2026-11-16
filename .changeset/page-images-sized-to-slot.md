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

Published page-builder pages can download images at about the size they are drawn. Pass `imageCopies: pageBuilderImageCopies(builder)` (from `@nextlyhq/plugin-page-builder`) to `createBlocksPage` or `createPublicBlocksPage`; both are experimental. With it, an Image block offers the copies the site's media keeps as `srcset` and `sizes`. How wide it is drawn on each device comes from the site's breakpoints, Columns and the block's own width, and no copy wider than twice that is sent. The images in the page's first top-level block load at once and with high priority. A background image the first section sets once is drawn from a copy sized to each device, and preloaded from the page's head. Where no copy can be had (an address on another site, a storage that keeps none, or no option set), the original is drawn as before.
