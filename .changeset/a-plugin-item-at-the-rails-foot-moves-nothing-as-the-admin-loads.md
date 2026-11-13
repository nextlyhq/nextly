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

A plugin's own item at the icon rail's foot no longer moves the rail as the admin finishes loading. The rail's foot is held to the bottom of the window, and the item was drawn inside the box that holds the Inbox and the account menu, so when the admin's answers arrived that box grew upwards by one item's height. The Inbox and the avatar stayed where their loading shapes stood, but the browser recorded the rail's foot as moving. The item now has a box of its own above the Inbox, which appears whole once the answers are in, so nothing already drawn on the rail moves. It looks the same as before: the item sits above the Inbox, in the same order and at the same spacing, and in the top bar (where a surface takes the rail away) nothing changes.
