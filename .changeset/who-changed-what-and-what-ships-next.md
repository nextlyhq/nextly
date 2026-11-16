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

Team activity replaces Recent activity on the dashboard. Each row says who created, saved, published, unpublished or deleted which entry or Single, names its collection by its label, and opens the entry; a deletion is not a link. It shows only events about what the reader may read. `core/recent-activity` is removed with no alias, and the `core#RecentActivity` component is now `core#TeamActivity`. A site's `admin.dashboard` overrides, `hide` or `replace` entries naming `core/recent-activity` should name `core/team-activity` instead. A saved layout that holds a Recent activity card keeps it as a row that is no longer drawn, so a reader who wants the card adds Team activity from the gallery. The rows of `GET /dashboard/activity` and of the `system:activity` source carry an `event`: `"created"`, `"saved"`, `"published"`, `"unpublished"` or `"deleted"`, the closed `ActivityEvent` type now exported from `nextly/widget-result`. Upcoming releases lists the Releases list's Upcoming tab, soonest first, read at the same instant as its stopped and overdue counts so a release is never in both or neither, with each release's entries and whether its checks found it Ready or "N issues", keeps its stopped and overdue line, hides while nothing is scheduled, stopped or overdue, and may be widened to the full row.
