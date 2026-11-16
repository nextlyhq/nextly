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

Pages stuck on the empty seeded header & footer set follow the site default again. Older pickers listed that set, which holds no header and no footer, by its own name beside "Site default", so a page that picked it stayed blank after the site default changed. Once, when the site starts on this version, the page builder moves every page naming that empty set to "Site default": the published version and any newer draft, without publishing anything, and the page's history records the move as the page builder's. The server log says how many pages it moved. From then on a page saved with that set (through the API, the admin, a duplicate or a batch) stores "Site default" instead.

The header & footer picker now offers the site default once, as "Site default (<name>)", and no longer lists the default set again by its own name, nor any set that holds no header and no footer. The set a page already names stays shown and selected. Nothing for a host to run: the move records that it is done in the page builder's own options table, with no schema change.
