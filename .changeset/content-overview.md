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

The admin has a Content overview at `/admin/content`: a table of the collections you can open, with each one's entries, drafts, last edit and a New action where you may create, and a table of the Singles, with who edited each last, when, and Edit. Collections that set `admin.sidebarGroup` are listed under their group. Clicking Content in the rail opens the overview with the Content panel beside it. `/admin/collections` and `/admin/singles` no longer redirect to the first item: each shows the overview with that one table. A role that can open only Singles is sent from `/admin/collections` to `/admin/singles`, and the other way round for collections only; with neither, each address says there is no content to open, and offers to create a collection to someone who may. A new endpoint, `GET /admin/api/dashboard/content`, answers every row the overview shows in one request.
