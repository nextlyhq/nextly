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

System health on the dashboard can now copy a diagnostics report. "Copy diagnostics", at the card's foot and in its Details drawer, copies a plain-text report ready for an issue or a chat: the Nextly, Node, Next.js and React versions, the environment, the database and whether its connection is encrypted (yes, no or unknown), migrations, storage, email, background jobs, each plugin with its version, how many collections, Singles, users and locales the site has, and how many server errors this server process answered in the last 24 hours. The report is built on the server from a fixed list of facts, so it never holds a password, key, token, connection string, host name, email address, person's name, entry content or environment variable's value. Details shows exactly what is copied. If the browser refuses the clipboard, Details opens with the report selected to copy by hand. Only super-admins can build the report (`GET /api/dashboard/diagnostics`).
