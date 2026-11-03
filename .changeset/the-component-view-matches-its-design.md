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

The page builder's component view is redrawn to its approved design. The banner is tinted with the component colour in both themes, has one Back that names the page it returns to, and says how many pages a change reaches, counting pages reached through other components and through Layouts (the site default included), with "at least" only when the count is incomplete. Each exposable property gets an icon button beside it in place of the "Expose to placements" switch, with the field's name in a dashed row under it once exposed. The fields list is flat rows with a type icon, the name and a plain source line, under a card naming the component and what it holds. Variant values sit in label-left rows with a dot for a value the variant sets, Reset as an icon and the placements' checkbox for visibility, and the canvas previews the open variant. "Save as component" and "Convert to component" are one "Turn into component…" item, whose dialog offers to keep the original blocks and names values by the block's own property labels.

The component facts route answers a `pages` count beside `reach`, and `@nextlyhq/blocks-engine` exports `variantPreview` (experimental).
