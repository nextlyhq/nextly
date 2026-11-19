---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-form-builder": patch
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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
---

Design's Spacing tab now shows what each value does.

- **Groups:** Spacing, Radius, Shadows, Content width and Other values, each
  with its own add row. Other values hides while empty. Every `space.`
  variable and the button paddings are under Spacing.
- **Plain names:** the built-in spacing reads "Space between blocks",
  "Section padding (top and bottom)", "Section padding (sides)", "Space
  between columns", "Card padding", "Space between paragraphs", "Button
  padding (top and bottom)" and "Button padding (sides)", and the content
  width reads "Content width". These names come from the engine's
  `tokenDisplayLabel`, so every surface says them, and a site's stored
  override, which carries no label, keeps them.
- **Descriptions:** a built-in's description shows under its name in its
  editor.
- **Previews:** each row previews its value. A spacing gets a bar at its
  value at the desktop width; a fluid one reads "Fluid · 16–20px". A radius
  gets a square with that radius on its corners. A shadow gets a small card
  wearing it. The content width reads in px ("1152px").

The button paddings join the Spacing group without being offered to a
block's spacing fields, which still list the spacing steps alone.
