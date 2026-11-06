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

The public reader (`createPublicReader`, `@experimental`) reads one Single as an anonymous visitor would:
`findSingle({ slug, select?, locale? })` answers the published document with the fields the public may read, or `null`
when there is nothing a visitor may see, and never creates the document. It takes the list read's fixed options and
refuses anything else by name; `toPublicFindSingle` is the read it becomes. Beside it in `nextly/runtime`:
`readPublicSiteSettings()` answers the site's name, address, logo and time zone and nothing else in the settings, and
`bindingFieldShapes({ collection } | { single })` answers the fields a visitor may read, with each one's type,
`hasMany`, `relationTo`, select options and whether a date holds a day or a month. Saving the general settings now
expires the cache tag `nextlySiteSettingsTags()` names.
