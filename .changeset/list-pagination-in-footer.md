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
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

Give `DataTableView` a `pagination` prop and let the table place its own pager.

A pager's placement depends on whether the row table or the mobile card view is showing, and `DataTableView` is the only component that knows: the pager sits inside the card on desktop and takes the column's gap on mobile. Every list used to build the pager markup itself and hand it over, which left that decision at the call site — where the wrong arrangement is the one you get by writing the markup in reading order, and where several surfaces had drifted into it.

Tables now pass `pagination` as data: `currentPage`, `pageSize`, `onPageChange` and the rest, typed as the pager's own props rather than a restatement of them. A caller supplying state has no opportunity to place the control, so the mistake is no longer available to make. API keys, deliveries, webhooks, collections, field groups, singles, roles, users, plugins, email providers, email templates, image sizes, entries and the media list view are all on it, and `MediaListView` forwards the prop rather than a node.

Two surfaces keep rendering a pager directly, and say why where they render it: the media grid, which has no row-versus-card view to place one for, and the user-fields list, whose drag-reorderable rows are drawn by a DndContext over a plain table rather than by `DataTableView`.

Two fixes found along the way. Choosing a larger page size on the image sizes list left the page number pointing past the end, showing the empty message over a list that had rows. And the media library's two pagers now carry distinct accessible labels rather than both announcing themselves as "Pagination".
