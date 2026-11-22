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

Design's import and export sit in a ⋯ menu named "More design actions" in the panel's header: "Import design tokens…", "Export design tokens (.json)" with the format, DTCG 2025.10, as a hint, "Export for Figma", and "Copy CSS variables". It replaces the sort-arrows button and its browser tooltip.

An export ends with a short toast that names the files in words, such as "Design tokens exported: variables, and dark values in a theme file (2 files)", instead of a box that stayed above the tab. When a file kept a value only as Nextly data or left one out, the toast offers "What wasn't exported": a list of each variable, "Kept for Nextly only" or "Left out", and why in plain words, such as "Figma keeps shadows as effect styles, not variables."

An import that refuses some values keeps its message on screen until you dismiss it, naming each refused value and why.

"Copy CSS variables" copies the site's variable blocks, light and dark, under the site's prefix, exactly as the site's stylesheet declares them, and a toast confirms the copy. It replaces "Export CSS".
