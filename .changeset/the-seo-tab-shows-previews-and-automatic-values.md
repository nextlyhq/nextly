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

The SEO plugin draws an SEO tab on the edit page of every entry and Single it adds SEO to, while creating one too: a preview of the page on Google and when shared that follows what is typed, the title and description first with the value each will use and where it comes from, one action back to automatic, and hiding from search, the official address, a different title when shared and the share image under Advanced. The count of the page's problems shows on the tab. The `seo` group is edited there and no longer among the page's fields. The group gains `socialTitle` and `socialDescription`, and `seoPlugin` takes `singles`.

A plugin's tab on an edit page can name the document fields it edits (`fields`), which the page then draws in the tab, and a contribution to a Single's page can name its Singles (`singles`).
