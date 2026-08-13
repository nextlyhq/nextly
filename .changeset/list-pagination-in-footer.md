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

Four admin lists passed pagination to `DataTableView`'s `footer`; eight rendered it as a sibling. The footer exists because the pager has to be mounted once — a stateful control otherwise gets a second instance, and new ids, when the layout switches — and because its placement depends on whether the table or the mobile card view is showing, which only `DataTableView` knows. A detached pager sits outside both decisions.

API keys, deliveries, collections, field groups, singles, email providers, email templates, image sizes and entries now pass it as `footer`. A test parses the admin sources and fails any `<Pagination>` rendered beside a `<DataTableView>` rather than inside its footer, with the four surfaces that paginate something other than a table named individually.
