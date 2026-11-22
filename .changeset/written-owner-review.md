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

A site's override of a plugin's email template written in blocks now has the plugin's later updates offered block by block (`@experimental`): each block the plugin changed, added or deleted is one change, a block it moved is one change for both places, and each takes Keep yours or Use theirs, with Undo restoring the site's blocks. `OwnerChange` gains `field: "blocks"`, `kind` and `blocks`, with `base`, `theirs` and `mine` describing the blocks in words; `EmailTemplateComparison` gains `inWords`; and `OwnerUpdateUndo` gains `baseBlocks`. Code that switches over `OwnerChange["field"]` needs a case for `"blocks"`.

Reset brings a written template up to its owner's new blocks even when they write the same email. A contributed template whose `htmlContent` isn't text is refused at startup, naming the plugin and the template, rather than registered with an empty body.
