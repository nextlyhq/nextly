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

A color box in the builder now suggests the site's color variables as you type. Typing "yellow 5" lists "Yellow 500" first, then "Yellow 300", each with its light and dark swatches, and typing a hex code lists the variables that hold that color. Enter connects the highlighted variable, stored as a reference just as picking it in the picker does, and leaving the box holding a variable's whole name connects it too (case, spaces and hyphens don't matter). A typed CSS color such as "yellow" is still written as that color, with the variables left listed as suggestions. Text that is neither a color nor a variable's name keeps the earlier color and says only "No color or variable is called "<text>".", without the dark-mode note. The list works with the arrow keys, Enter and Escape, and reads as a combobox while it is open.
