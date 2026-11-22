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

Every control in the block panel says what it writes. Hovering a control, or reaching it from the keyboard, shows a tooltip with the CSS or HTML it sets, such as `min-height: 120px` for a field, `min-height: 100svh` for a Section's Full screen height, `<section>` for the HTML tag, `id` for the Anchor and `class="nx-pb-contained"` for Boxed content width. The tooltip replaces the browser's own title tooltips on the Style fields. It opens at once on keyboard focus, stays while the pointer is over it, closes on Escape without that Escape reaching the editor, and moves nothing in the panel.

A new **Show CSS names** item in the panel's ⋯ menu prints each control's CSS property names in small monospace under its label, and adds them to the control's description for screen readers while it is on. It is kept with the editor's other preferences as `showCssNames`, off by default.
