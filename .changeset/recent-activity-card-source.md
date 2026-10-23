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

The dashboard's Recent activity card is now an ordinary framed card, answered by a new `system:activity` widget source through the dashboard's batch request, the same way the other cards are.

- `system:activity` makes the same read as `GET /api/dashboard/activity`, through the same service call: the same per-row read check, the same grouping of repeated saves, the same row limit. The card and the endpoint show a reader the same rows. The source refuses any query field it doesn't answer (a filter, a sort, a status).
- The card has a "Number of items" setting (1 to 25, 5 by default) and draws the rows its size allows. When there are more, it says "More exist", like the other list cards. With nothing to show, it uses the standard empty state.
- `WidgetComponentProps` gains an optional `query` (experimental): the query a custom card asked, with its reader's settings applied. A custom widget that carries a query can now size its rows by the same rule.
- Recent activity now leaves out collections kept off the dashboard (internal, or hidden from the admin's navigation, such as the page builder's patterns and layouts), for every reader, super-admins included. This is the rule the dashboard's other cards and its 24-hour activity count already apply. If the collections registry can't be read, the feed shows no rows rather than risk showing a hidden collection's, as the count shows none.
- The activity read applies one row limit for every caller: 5 by default, at most 50.
  - `GET /api/dashboard/activity` already clamped to 1–50 with 5 by default, so it's unchanged, `?limit=0` and a non-number still answering the default.
  - A direct caller of the activity service that passes no limit now gets 5 rows instead of 10.
- `RecentActivity` (the section reading the endpoint) and `useRecentActivity` stay exported, deprecated; the dashboard no longer uses them.
