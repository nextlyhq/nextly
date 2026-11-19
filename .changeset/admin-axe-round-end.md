---
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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
---

Accessibility fixes from an axe-core 4.14 scan of the admin and the Page Builder. The notification bell is named with the count its badge draws ("Notifications, 3 unread", or "9+" past nine), so the name says what a person sees. The media library's rows and the content sidebar's headings draw a real space between a name and its count, so the two no longer read as one word. Each dashboard widget section's "Reset to defaults" is named "Reset to defaults, Content" (and so on), its drawn words first. The Schedule dialog's time zone control is named by its zone and offset in the order drawn. "SEO settings" in the Page Builder's page settings and "Change in Pages ▸ Header & footer" in its site settings read in the text colour, underlined, instead of the brand colour, which an indigo brand drew under 4.5:1. "+ Add CSS property" is at least 24px tall. The editor's Ctrl+K search list holds only its groups and rows: the divider between groups is drawn without a separator role, and a group's "Searching pages…" is said from a status line outside the list.
