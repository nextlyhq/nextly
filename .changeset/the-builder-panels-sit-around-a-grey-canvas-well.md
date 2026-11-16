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

The page builder's panels and the page now look apart. The rail, the side panels, the top bar and every menu and popover the builder opens sit on one panel surface (white in the light theme, the admin's raised dark surface in the dark one), and the page sits on a plain grey well a step darker, with 1px dividers between them that turn to the text colour when the system asks for more contrast and to the system's colours in forced colours. Every enabled button, menu item, tab and toggle in the builder's chrome now shows the hand cursor, while the canvas keeps its own grab and text cursors. The left and right panel toggles draw an open or close panel icon, are filled while their panel shows, and say "Hide the left panel" or "Show the left panel" (and the same for the right) in their tooltip.
