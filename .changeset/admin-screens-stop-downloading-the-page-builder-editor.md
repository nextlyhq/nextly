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

The page builder's editor no longer downloads with every admin screen. The plugin's admin module now registers its screens and fields and fetches each one's code when a screen first draws it, so the sign-in page and the dashboard carry about 5 KB of page-builder code instead of about 390 KB (gzipped, on the playground's production build), and the editor's stylesheet loads with the parts it styles instead of on every screen. Inside the builder, the site's code settings load when the Site tab draws them. URLs and how a site registers the plugin are unchanged. An admin page that still imports `@nextlyhq/plugin-page-builder/styles/editor.css` by hand keeps working, but loads the stylesheet on every admin screen; remove the import to get the saving.
