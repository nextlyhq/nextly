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

The Design panel's Styles tab has two sections, each with a line saying what it holds: "Block styles" ("Saved looks for one kind of block. ★ is the look a block has until you pick another.") and "Shared styles" ("Your own styles for any block.").

- **Block styles** are listed by block type, each type folding like the other Design groups and remembered, each style a tile drawn on a sample of its block, and each type ending with "+ New <block> style" (for example "+ New button style"). That asks for a name, makes the style from the ★ style's values and opens it in the style editor.
- A block style the site made can be renamed (its name only, so every page wearing it keeps it), duplicated and removed. Removal takes one step, and is refused while a page uses the style.
- A built-in block style (one a block or a plugin supplies in code) can be edited, duplicated, and hidden and shown again, but never renamed or removed.
- "Set as default ★" makes a style the look its blocks have until another is picked, one per block type. Choosing it on the block's own style gives the ★ back.
- Each row's ⋯ menu holds these actions. F2 renames in place, and the menu key or Shift+F10 opens the menu, which closes back onto the row. A role that may not change the site's design sees the styles with no action.
- While a ★ style is edited, the canvas marks the blocks that picked no style along with those wearing it.
- A removal refused because a style is still used now names the documents using it that you may open, up to three, then how many more ("Card is used on 5 documents: Home, About, Contact and 2 more."). This holds for shared styles too, through the panel and the removal route.
