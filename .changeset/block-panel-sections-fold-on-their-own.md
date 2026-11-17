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

The block panel's sections fold on their own, on every tab. Each tab is a list of sections divided by lines, each with a bold name, a chevron, and a dot beside the name while it holds a value (read as "has changes" by a screen reader). Any number of sections can be open at once. They stay as the author left them, per tab and section name, across blocks and visits, kept with the editor's other preferences as a new optional `sectionFolds`. A section nothing remembers opens if it holds a value or is the tab's first. A new ⋯ menu beside the tabs offers Expand all and Collapse all for the tab showing.

The Style tab lists its sections in one order for every block: Block style, Layout, Inside its parent, Spacing, Size, Position, Text, Background, Border, Effects, Icon, CSS properties. Typography is now called Text. Advanced lists Visibility, then HTML. Every section's frame reads one panel token, `--nx-builder-section-frame`, none by default, so cards around sections can be tried by changing one value.
