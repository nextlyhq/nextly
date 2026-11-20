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

The SEO plugin's checks now leave a page's kept result alone when they find the page as it was, apart from the time. A full site check (Check again, or opening the Overview or Problems screen once a day) used to write every page's result again; it now writes only the pages whose results changed, so a site that hasn't changed is checked without writing anything for its pages. At 2,000 unchanged pages the check takes about 1.6 s on SQLite (was 6 to 7 s), 5 s on PostgreSQL (was about 52 s) and 5 s on MySQL (was 30 to 35 s). What the checks find is unchanged.

One stored value changes meaning: `checkedAt` on a page's row in the plugin's list of checks now says when a check last found that page changed, not when it was last checked. When the whole site was last checked is still kept on the site's own row, and it's what the screens show. Nothing in Nextly reads a page row's `checkedAt` as a sign of how fresh it is.
