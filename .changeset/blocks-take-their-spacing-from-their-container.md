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

Blocks now carry no outer margin; the space between blocks comes from the block holding them. A heading, paragraph, list, figure, quote, rule and code block have no margin above or below (an `h2` drew 42px above and 14px below), and a figure has none at its sides, so a captioned image sits as flush as one without a caption. Section, Box, Card, Column, an accordion item and a collection loop put a gap above every block after the first, which becomes `gap` when the container is set to flex or grid. Rich text spaces its own paragraphs inside the block. Section is padded above, below and at the sides, Card is padded, and Button padding is 12 × 20. Every value is a site variable (`space.stack`, `space.section-y`, `space.gutter`, `space.columns`, `space.card`, `space.paragraph`, `button.padding-y`, `button.padding-x`), most growing with the screen, and spacing set on a block always wins over them (in flex or grid a block's own margin adds to the container's gap). A `childGap` must be a length both a margin and a gap take, so a negative one is refused at registration. The canvas labels a container's gap "Gap · from Section". Block definitions take a new optional `childGap`.

**Visual change.** Existing pages move: headings lose their space above and below, paragraphs lose the space below them and gain the container's gap above, Divider and Quote lose their space above and below, Sections gain 48–80px of padding above and below and 16–32px at the sides, Cards gain 16–24px of padding, Columns and Gallery gaps grow from 16px to 16–32px, and Buttons grow. Stored page stylesheets are recompiled on their next render rather than served with the old spacing; a render under a host-fetch policy judges their URLs by that policy as it does, and one that names a policy without its predicate withholds them. To keep a block's old look, set its spacing explicitly in Style → Spacing (or change the variables under Design → Variables).
