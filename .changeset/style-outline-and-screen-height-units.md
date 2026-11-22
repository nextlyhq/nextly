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

Blocks can be given an outline, and a height can be set in the screen's small, dynamic or large height.

- **Outline.** The style catalogue gains `outline`, in the border group: a width, a style (including `auto`, the browser's own focus ring), a colour and an offset, compiled to `outline-width`, `outline-style`, `outline-color` and `outline-offset`. An outline is drawn outside the border and takes no space, so setting one never moves the layout. It has an effect on any block. A block with `supports: { border: true }`, as every core block has, offers it. A block can also opt into the outline alone with the new `outline` flag, `supports: { border: { outline: true } }`, which the plugin SDK's `BlockSupportKeys` now names beside `line` and `radius`.
- **In the Style tab,** Outline sits in Border behind "+ More". While the Focus state is edited it shows without being asked for, since a focus ring is what an outline is mostly for. `auto` reads "Browser's focus ring".
- **Screen-height units.** The unit menu of Height, Min height and Max height now offers `svh`, `dvh` and `lvh` after `vh`. On a phone, `100vh` is the height with the browser's toolbar hidden, so a block sized by it runs under the toolbar while the toolbar shows. `svh` is the height with the toolbar showing, `lvh` with it hidden, and `dvh` follows it as it moves. Every other length keeps its shorter menu, and these units can still be typed anywhere.

Every new value is one web.dev's Baseline marks widely available in the pinned web-features release, and the Baseline test now covers the units the menus offer as well as the properties and keywords.

Existing pages don't change. A test holds a page styled with every property the catalogue had before the outline was added to the exact CSS it compiled to then. Every stored document and every block's declared `supports` stays valid.
