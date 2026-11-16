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

The SEO plugin can now add its `seo` group to every content type, with no list to keep up to date.

- **`seoPlugin()` without `collections` or `singles`** adds SEO to every collection and Single the site defines, in code or in the Schema Builder, including types made later (each gets the group when the site next starts), and to Page Builder's pages. Users, media and other plugins' collections never get it. A type that already has a field of its own named `seo` is left as it is, with a warning at start, and gets no SEO tab.
- **Sites that name `collections` or `singles` keep exactly that list.** Nothing changes for them on upgrade. To move to every type, remove the list, then run `nextly migrate:create` and `nextly migrate` so each type gains its `seo` column.
- **`exclude`** (experimental) leaves named types without SEO, such as an internal log. A type left out later keeps its column and values until `nextly prune`. **`include`** (experimental) adds a plugin's collection whose pages are public. Both apply only where no list is named, and are refused beside one.
- Where SEO is on every type, `pagePermissions` is refused, because each type's permission is declared before the site starts; name the types to use it. The dashboard's SEO issues card and its Needs attention line are shown to whoever holds `manage-seo`.
- The SEO tab, the problem list, Inspect, bulk edit, import, the setup checklist, IndexNow and the settings' Content types tab all read the types that have SEO when they run, so a Schema Builder type is covered as soon as it has the group.
