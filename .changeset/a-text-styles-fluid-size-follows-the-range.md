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

A text style's size made with Fluid… now follows the site's fluid range. Before, changing the range (for example from 360–1280px to 400–800px) remade fluid variables and Site text rows but left a text style's fluid size on the old range, on the canvas and on published pages. The text style now keeps the two sizes it was made from, and the save that changes the range makes its size again across the new one, in the same save. A size typed by hand, or one following a variable, is left as it is, and so is every text style without a fluid size. If a locked text style follows the range, the range change is refused, naming the style, and nothing is saved: unlock it first. A copy of a text style keeps its fluid sizes too. Not yet covered: a text style supplied by the site's code doesn't follow range changes, and locks don't apply to it.
