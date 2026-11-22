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

The dashboard's "Continue where you left off" card now shows every pin. On its Mine tab, pins sit in their own "Pinned" group, newest first and each led by a pin, above "Recent"; while there are recent saves, pins take the card's rows less two (three of the default five). When there are more pins than the card shows, "View all pins (N)" opens a dialog listing every pin, newest first, each opening its document and each with "Unpin". The dialog also counts pins of documents you can no longer open, with "Remove them", so they stop counting toward the limit.

Pinning now says "Pinned to your dashboard." only while the card is on your dashboard, and otherwise says how to add it. At the limit, the refusal reads "You can keep up to 20 pins. Unpin one first." with "View all pins", which opens the dialog on any screen.

`GET /api/dashboard/pins` also answers `unreadableCount`, how many of your pins name documents you can no longer open, and `DELETE /api/dashboard/pins?unreadable=1` removes those pins on the server.
