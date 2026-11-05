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

On a wide screen, the admin's main column no longer slides sideways when the second sidebar panel opens or closes. Moving between the dashboard and a collection list, the media library, a plugin or settings used to move the whole column 256 px as the panel beside it opened and closed. The panel's column is now held on every screen of the wide layout, empty where the screen has no panel, so the column the reader was reading stays where it was. Screens without a panel, the dashboard among them, are 256 px narrower as a result, and the dashboard's cards wrap to that width; nothing saved changes. An editor that takes the full width still releases the panel's column, and on a phone the panel still opens over the page in the navigation drawer.
