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

In the page builder's Design panel, a size variable (a spacing, a radius, a type size or any other length) is now edited with the same number and unit menu as a block's lengths, offering px, rem, em, %, vw and vh. A bare number takes the unit the menu shows, so `16` with px saves as 16px, and `calc()`, `clamp()`, `min()` and `max()` can still be typed. Hovering the control shows the CSS the variable writes, such as `--site-space-4: 1rem`. A type size's line height is a plain number marked "×", meaning times the text size. When it is above 4, the editor says "20× the text size. Did you mean 20px?" and offers "Use 20px".
