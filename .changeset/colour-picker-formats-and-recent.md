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

The colour picker takes a colour in any common notation, picks one from the screen, and keeps the author's recent colours.

- Type or paste a colour as hex (3, 4, 6 or 8 digits), `rgb()`/`rgba()` or `hsl()`/`hsla()`, in either CSS syntax. A Hex / RGB / HSL switch shows the same colour in each notation without changing it; the picker still reports hex.
- "Pick from screen" samples a colour where the browser has an eyedropper (Chrome and Edge). Elsewhere there is no button and no hint about one.
- "Recent colours" lists the last eight raw colours the author typed or picked, newest first. A block's colour picker lists the site's colour variables, then Recent colours, then the custom picker; a colour variable's picker in Design shows the same list. Picking one writes it in the form it was listed, and on a block it is marked "Not adapted to dark mode" as any raw colour is. The page builder keeps the list per signed-in author in the browser, through the admin's preference store, never in the site.
- `@nextlyhq/ui`: `ColorPicker` takes `onRecentSelect` to hand a recent colour back as listed. `@nextlyhq/builder/shell` exports `RecentColoursStore`, the context a host provides the author's store through.
