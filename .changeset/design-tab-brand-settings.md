---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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

The Email hub's Design tab now edits the brand settings beside a live preview. Pick an email, and the preview shows each change to the logo, its width, the accent, background and content colours, the font and the footer before anything is saved; a save bar says how many emails a save changes. Where the page builder's site style defines colours, **Match my site** offers its light-theme colours for each part of the email, suggesting the ones named for each, and the site's font where email clients have it or the closest email-safe one, saying which. The tab says which emails the brand settings reach and why they don't reach the others, and warns when the site's own Default layout keeps them from its emails. Layouts list the emails each one wraps and open in the same workbench as an email, and a layout kept as the previous engine sent it, or with an update from its owner, is said there too. The draft preview (`POST /api/email-templates/preview`) takes an optional `brand` change, checked by the rules a save is and laid over the saved settings for that render only.
