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

Page builder: the Add panel adds a block after the selected one, or at the end of the page
when nothing is selected, so five clicks make five blocks in a row. When the selection's
container cannot take a block, the click adds it after the nearest block that can, and the
block's tile says where it will go. A block that only belongs inside a container, such as
an accordion's item, goes inside the selected container once nothing after it would take it;
anywhere else its tile says, in one sentence, where it goes and what to do ("Goes inside an
Accordion. Select an Accordion first, or drag this into one."). An empty container's "+"
adds inside it. The panel opens with nothing highlighted, in Blocks and Sections tabs, under a
line naming where the next block goes. Tiles are grouped as Layout, Text, Media,
Interactive, Your components and More blocks, most used first; Divider now sits under
Layout, beside Spacer. A popover describes the tile under the
pointer or the arrow keys. A block that cannot go anywhere from here stays listed, greyed,
with the reason. A library notice shows in the tab that offers that tier. Every core block now describes itself in one plain line. The relation
search reads only for blocks the editor can draw.
