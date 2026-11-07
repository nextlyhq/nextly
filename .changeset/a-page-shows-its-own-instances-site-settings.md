---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
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

A block page shows the site settings of the Nextly instance its route is given. `createBlocksPage`, `createPublicBlocksPage` and the Single page factories read a page's site name, address, logo and time zone, which its dates and day filters use, through their `nextly` option, as they read its content. Before, they read the process's registered instance, so in a process serving several sites a page could show another site's name and time zone. A route given no `nextly` reads the process's instance as before. A reader of your own forwards `publicSiteSettings` from the instance (`publicSiteSettings: async () => (await getNextly({ config })).publicSiteSettings()`). One that does not keeps showing the process's registered instance's settings, so a single-site app is unchanged, and the route now warns once per reader, in every environment, that on a process serving several sites these are another site's.

`nextly` adds `publicSiteSettings()` to the Nextly instance, and `readPublicSiteSettings` from `nextly/runtime` takes an optional instance to read from, with the `PublicSiteSettingsSource` type (all `@experimental`). Given none, it reads the process's registered instance as before.
