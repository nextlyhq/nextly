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

A block sets its size inside its parent in plain words. Style › Inside its parent offers Width: Fill, Fit or Fixed, and Height the same under a Row or a Grid. Each choice has a line saying what it does and its CSS on hover.

- Each choice writes what it means for the parent's arrangement at the device being edited. In a Row, Fill takes the rest of the row; in a Grid or a Stack, it stretches.
- Under a Row stacked on a device, a block is sized as in a Stack there, and Fill or Fit replace a width fixed at a wider device.
- The choice is read back from the block's values, and anything else reads as Custom with its CSS rows.
- The settings search finds Width and Height by their names and choices.
