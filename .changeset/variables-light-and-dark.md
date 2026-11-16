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

Variables in the page builder now work with light and dark, and are easier to read and change.

- The Design panel shows variables as compact rows in plain words, grouped as Colours, Type scale, and Spacing, radius & shadows, with a preview switch for light and dark. Each opens an editor beside the panel. The Classes tab is now called Shared styles.
- A variable can have an optional `label`, its name in plain words. With none, one is made from the code name (`color.brand` reads "Brand"). Existing sites need no change.
- Dark values now work with no setup: the published site uses them when the visitor's device prefers dark. A `data-nx-theme="light"` or `"dark"` attribute on the page still chooses a mode either way. The `darkMode` setting is deprecated: it is still accepted and no longer changes anything.
- Until the editor has its own light and dark preview, its canvas follows your device's setting.
- Import reads DTCG 2025.10 files, resolves aliases, reads a theme file or Figma's one file per mode, and shows what will change before applying it. Export offers DTCG (with a theme file when there are dark values), For Figma, and CSS.
- A colour written as a value rather than through a variable is marked "Not adapted to dark mode" in the style panel.
