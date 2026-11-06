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

The page builder's inspector now opens with a card for the selected block: its icon, type and label, a line about it, a line for each lock that holds it, and a menu with Rename, Lock or Unlock, Duplicate and Delete. It has two tabs, Content and Style; a block's CSS id and custom attributes moved to Content → Advanced. The Style tab opens with a bar that says what an edit changes (this block, the device, and the state, now called Normal, Hover, Focus and Pressed) and lists its sections as Layout, Spacing, Size, Position, Typography, Background, Border and Effects, with the common controls first and the rest behind "+ More". Controls offer only CSS that Baseline marks widely available; a stored value no longer offered stays visible and can be cleared. A locked block's controls, and the design controls of a block in a content-only area, are read-only and say why.
