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

A block in a written email can be shown only when a variable has a value, is yes or is no (`@experimental`): choose Show only when in the block's menu. The block carries its condition as a label that can be removed. The variables offered there, and for a link, include every declared path, nested fields too.

A saved written email can be converted to code from the workbench's menu. The dialog says the change can't be undone, shows the HTML and Liquid the email becomes, and waits until unsaved edits are saved; the server writes the code from the saved blocks, keeping every variable, condition and list as Liquid. For this, the draft preview of a written email now also returns `source: { html, text }`, its compiled code before any data.

`allowedUrl`, the check a save applies to a written email's link and image addresses, is exported from `nextly/api/email-template-preview-types`, so an editor can check an address with the same rule.

In a written email's plain-text body, a link across a bold word, a chip or a line break now gives its address once, after the whole phrase, instead of after each part of it.

A chip inside a list with no items is marked as showing nothing, whatever it holds. A chip that stands for an image address counts only a complete address.
