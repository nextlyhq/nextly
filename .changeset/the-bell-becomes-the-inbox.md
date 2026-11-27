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

The bell is now the **Inbox**: a tray icon at the foot of the rail, with tabs for **For you** and **Alerts** and an unread count in each. An item is marked read when you open it, never just because the Inbox showed it, and a read item can be marked unread again from its menu. "Mark all read" marks the tab shown. Read state is kept on the server, so the count is the same in every browser and on every device, and it refreshes when you come back to the tab and every minute. The schema-change journal is no longer in the Inbox: it stays in the terminal and the migrations log, and is moving to a page of its own under Builders. New and experimental: a `tab` filter on `/api/notices` and on `nextly.notices.find` and `count`, an `alerts` figure beside `total` in `/api/notices/count`, `tab` on "mark all read", `POST /api/notices/unread`, and `nextly.notices.markUnread`. A notice's `readAt` is now the time it was read, cleared while it is unread: marking a notice unread clears it, and reading it again records the new time. Code that read `readAt` as the first read should treat it as the latest.
