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

Email moves from the main navigation into Settings, at `/admin/settings/email`, with its Messages, Design and Sending tabs unchanged; every old `/admin/email/...` link redirects to the same page there, keeping its id and query string. The Settings panel is now grouped as Site (General, Email), People (Users, Roles) and Developers (API Keys, Webhooks, Background Jobs), followed by plugin settings, and a group appears only when you can open something in it. A reader who can only see Email still gets a Settings entry, which lands on Email. User fields are no longer a Settings item: a Fields button beside Create User on the Users page opens them, for anyone allowed to read settings, and their trail reads Settings › Users › Fields. The Translations entry shows only on a site that configures two or more locales.
