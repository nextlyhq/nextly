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

The SEO settings' Content types tab now carries each type's SEO switch.

- Collections and Singles are listed in two groups, each type with where it was made (in code or in the Schema Builder), its entry count and an example address. Rows start closed and open one at a time to the title pattern, Hide from search and structured data. Singles with SEO are listed for the first time.
- Each type has a switch, on by default. Switching one off says before saving that its pages lose their SEO and that nothing is deleted; switching a saved-off type back on says its values are used again. The bar under the tab names each switch waiting to be saved. Without permission to change the settings the switches show their state and cannot be moved.
- A site's own type without SEO sits greyed at the end of its group with the reason: left out in the site's code, or holding its own field named `seo`, with a link to Import.
- Past ten types, a search box and an All, SEO on, SEO off filter appear.
- Pages marks a page of a type with SEO off as "SEO off", says its title is set by its own code, and offers no Edit SEO. The Overview's Pages card counts those pages on a "Pages with SEO off" line that opens Pages filtered to them (`?status=seo-off`).
- The content types route answers each type's `kind` and `source`, and a type without SEO its `reason`; the settings document route answers `canChange`.
