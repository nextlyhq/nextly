---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
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

The page builder's inspector sets alignment and direction with icons. Justify content, align items, align content, flex direction, flex wrap and text align are each a radio group of icons with one tab stop, named in words and shown in a tooltip on hover and focus. The icons follow the container's layout as the canvas draws it: upright in a column, turned in a vertical writing mode, and mirrored in a right-to-left element. Start and end stay on the writing mode's edges, as CSS defines them, and the wrap icons follow the way lines advance. The values without an icon, such as `safe center` or `first baseline`, sit in a small list beside the group, where a stored one shows.

The page builder's Style tab has one reset per row. A value set at the edited breakpoint shows a reset icon at the end of its control's row, with a tooltip saying what it reveals ("Reset to unset", or the wider breakpoint whose value shows through). This replaces the "Reset to unset" line that made each set control two rows, and the separate clear buttons on lists and icon groups. Where the cascade has no answer for a row, because the panel has none or is editing a breakpoint the canvas is not showing, a value stored at the edited address still gets the reset. The Content tab's Advanced section draws the panel's chevron in place of the browser's triangle.
