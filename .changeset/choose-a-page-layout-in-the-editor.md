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

Choose a page's Layout in the editor. One **Layout** picker, at the top of the editor's Settings and on the page's Page Builder card, offers the site default (named), each Layout (unpublished ones marked) and "No header or footer", and the line under it says which Layout is in effect and why. The page's two stored values are now set only through that picker, so the form no longer shows them as separate fields.

The editor draws the Layout's header and footer around the page, locked, as visitors get them. A click on a region shows where it comes from, with "Edit Layout ↗" opening the Layout in a new tab for authors who may edit it, and Layers lists the regions as locked rows. Publishing a page that names an unpublished Layout now tells you the site default shows until that Layout is published.
