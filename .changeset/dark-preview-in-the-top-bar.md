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

The light and dark preview moves to the builder's top bar, beside the device buttons: a sun and moon switch, shown once any of the site's variables has a dark value. Pressing the moon draws the whole canvas in its dark values at once, the page and its header and footer, and the Design panel shows the dark values too, whatever your own device is set to. It is a preview only and stores nothing: it is kept while you move between pages, a new session starts in light, and visitors still see what their own device is set to. The Design panel no longer has a Preview switch of its own, and the canvas no longer shows a "Dark preview · Use device" tag. The switch disappears, and the canvas returns to light, when the last dark value is removed.
