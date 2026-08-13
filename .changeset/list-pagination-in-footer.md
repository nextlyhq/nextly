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

Render every list pager inside its table instead of beside it.

Some admin lists passed pagination to `DataTableView`'s `footer` and the rest rendered it as a sibling. The footer exists because a pager's placement depends on whether the row table or the mobile card view is showing, and `DataTableView` is the only component that knows: it sits inside the card on desktop and takes the column's gap on mobile. A pager rendered beside the table sits outside that decision, so it lands in the wrong place on one of the two layouts.

API keys, deliveries, collections, field groups, singles, email providers, email templates, image sizes, entries and the media list view now pass it as `footer`. A test parses the admin sources and fails any `<Pagination>` rendered beside a `<DataTableView>` rather than inside its footer; a surface that paginates something other than a table is named individually, by the pager's accessible label.

Two fixes found along the way. Choosing a larger page size on the image sizes list left the page number pointing past the end of the list, showing the empty message over a list that had rows. And the media library's two pagers now carry distinct accessible labels rather than both announcing themselves as "Pagination".
