---
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
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
---

The Style tab now shows a setting as a normal row only where it does something for the selected block. With Display at Block, the flex and grid rows (Direction, Wrap, Column sizes and the rest) stay out of the way; a Flex block shows its flex rows and no grid ones, and a Grid block the reverse. An image shows Fit, Focal point and Aspect ratio; a box shows none of them, and keeps Aspect ratio under "+ More". A value you have set always stays visible, even after a change makes it do nothing, so nothing is lost. Until the canvas has drawn the block, every row is shown.

Blocks inside a Row or a Grid get new size settings: Grow, Shrink, Starting size, Align self and Order inside a Row, and Align self, Justify self and Order inside a Grid. Grids also get Justify items. They write CSS only where you set them.

For developers: every property in the block engine's style catalog now records when it has an effect (`appliesWhen`), and `applies(property, context)` answers whether it does for a given block. The catalog gains `flexGrow`, `flexShrink`, `flexBasis`, `alignSelf`, `justifySelf` and `order` in the `dimensions` group, so every block with a size gets them, and `justifyItems` in `layout`. The style catalog reference lists where each property applies.
