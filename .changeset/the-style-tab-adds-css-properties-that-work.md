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

The page builder's Style tab no longer has a "+ More" in each section. Each section shows the settings people reach for first, and the tab ends with **CSS properties**: the properties you added, each by its CSS name with its value and a ✕ to remove it, and **+ Add CSS property**, which opens a list you can search of only the properties that work on the block as it is now, each with its CSS name, its plain name and the section it belongs to ("Only properties that work on this block are listed."). A block laid out as a plain stack isn't offered the flex or grid ones, and z-index is offered on its own, once the block is positioned or sits in a row or grid. A picked property's row appears with its value focused. Removing a row clears its value in one step that Undo brings back, and focus moves to the next row or back to the button. When nothing that applies is left, the list says "Nothing left that applies here." "Find a setting" finds these properties too, by their plain or CSS names, and lists one the block hasn't added with an **Add** button. The list offers only the engine's catalog properties, never free CSS.
