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

Every Design value now previews as it is edited. A size, a line height, a duration, a shadow (its sizes, its colour or its CSS) is drawn on the canvas as it is typed, and a font or a weight as the keyboard or the pointer moves through its list. Each is still written to the site only once, when the edit ends: on leaving the field, pressing Enter, or picking from the list. A value that isn't valid yet, such as `2r` or a negative blur, keeps the last valid one on the canvas, and closing the editor or the list without a pick draws the stored value again.

For a host of the builder's Design panel, `TokensPanel`'s `onPreview` is now called for every kind of value, not only colours and text.
