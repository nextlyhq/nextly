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

The SEO plugin's admin is now one section with its own menu: Overview, Pages, Problems, Redirects
and Settings, each screen showing its place in the admin's top bar (SEO / Pages / Import). The
section opens on its Overview: a setup checklist worked out from the plugin's stored state (hide it
and it stays hidden until shown again), the site's search health with its errors, warnings and
notices linking to Problems, how the site's public pages stand, the addresses not found in the last
week with a Redirect for each, and Search Console, IndexNow and the redirects running on the site.
First-time setup ends on the Overview.

Every kind of problem now has a severity, and a problem is counted once for each page a check fails
on and once for a check of the whole site. The SEO menu's Problems item shows the errors and
warnings as a badge, the same number the dashboard's SEO problems line now counts. The Bulk edit and
What search engines received menu items are gone; their old addresses open Pages, and Inspect for
the page an old link named. Each page the Pages list answers says where its title and description
come from.

`navigateTo` from `@nextlyhq/plugin-sdk/admin` takes `{ replace: true }`, to move without leaving the
current address in the history.
