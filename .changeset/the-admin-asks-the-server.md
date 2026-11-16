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

The admin now learns from the server what you may do with each collection and Single, so a collection's code access rule is reflected in what it offers, not only the permissions your roles hold: the collection and Single pages, the dashboard's quick-create shortcuts and the navigation all follow that answer. It is asked in the content language on screen, kept between pages rather than asked again by every component, and asked again on focus, when your soonest role assignment ends, after a change to roles, permissions or role assignments, and after a schema change. Once that role assignment has ended, the earlier answer no longer counts, even if asking again fails. Until the server has answered, no collection or Single is offered. The system sections (users, roles, media, settings, email, webhooks, releases) are still offered from your permission list, and stay available when only the answer about collections fails.
