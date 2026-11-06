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

In the page builder, the Style tab says what an edit changes: "This block", or a shared style the block wears, chosen from chips at the top. With a shared style chosen, the controls change that style everywhere it is used, the bar says how many blocks and pages it reaches, and Undo takes the change back; a locked style, or one your role may not change, is shown read-only. Any block can be saved as a new shared style ("Save as shared style…" in the block's menu, the toolbar, the right-click menu or the Style tab), which moves its look into the style without changing how it looks. A value that comes from a shared style says so, a value set on the block says what it overrides with a Reset, and "Move to" puts a block's value into its shared style. A shared style can be applied to a block, taken off it, or detached so the block keeps the look on its own. A block can no longer make an empty shared style by typing a name. In `@nextlyhq/builder/shell`, the experimental class selector applies existing styles only (its `onCreateClass` prop and the `ClassCreation` type are gone), and `StyleInspectorPanel` takes a `target` in place of its class props.
