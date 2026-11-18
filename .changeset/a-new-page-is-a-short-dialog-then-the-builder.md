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

A new page is one short dialog, then straight into the builder. "+ New page" on the Pages list, and "New page" in the builder's Pages panel, ask for a title, show the address made from it (editable, and said before creating when it is taken and becomes `-2`), the header & footer, and, once the site offers starter pages, what to start from. "Create and open builder" saves a draft and opens it with Add open. A typed address another page uses is refused, naming that page; nothing is ever created by clicking away; and from the builder, unsaved changes on the page on screen are asked about first (Save, Discard or Keep editing). The panel's bare title field is gone.

The plugin's pages route takes the typed address, the header & footer choice, a starter and other fields, answers whether the author may change the page they made, and gains a read of what a new page would get, all `@experimental`; a caller sending only the collection and title gets a page made as before. `@nextlyhq/plugin-sdk/admin` gains `useLeaveWithoutWarning` (`@experimental`).
