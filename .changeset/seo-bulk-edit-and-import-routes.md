---
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
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

`@nextlyhq/plugin-seo` can now edit titles and descriptions for many pages at once, and import SEO values from where a site keeps them today. Its new routes read a content type's pages with what was typed and what each would be automatically, and save the changes in one step, refusing every change where any page was saved by someone else since it was read. The import reads an existing field group on the site's content types (with each field matched by a person), the plugin's own group as earlier versions stored it, a WordPress export of Yoast SEO or Rank Math, Rank Math's CSV, or a Payload export. A dry run shows what would change and changes nothing; the apply writes exactly that, in one transaction, or nothing where anything fails part-way or a page changed since. Values only go into empty places, a value a person already typed is kept, and one the same as the automatic value is left automatic. Importing needs the permission to change the SEO settings. An upgraded site keeps every value its `seo` group holds; on a translated content type the group's values become the default language's.
