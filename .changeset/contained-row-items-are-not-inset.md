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

A contained block laid out as a flex item, such as two contained Boxes side by side in a flex row, is no longer inset from the whole row's width, which over-padded it and made a wide page overflow. It is treated as a sized block: centred within its own share of the row, with the gutter at each side. The rule that sets a block's `display` now also writes `--nx-sized-item` on its children, `1` for a flex layout and `0` for any other, at the same breakpoint and state, and the site sheet's containment inset reads it. A grid item, such as a contained Column in Columns, needs no flag: its inset is measured from its own grid area. A block's `flex-direction` sets `--nx-column-flow` the same way, so a flex column's items, which fill its width, keep their inset. A block's own `position` sets `--nx-out-of-flow` the same way, `1` for `absolute` or `fixed`, so a positioned child of a row, which is not a flex item, keeps its inset. Because the compiled CSS changes, every stored page stylesheet is recompiled once, on its next read.
