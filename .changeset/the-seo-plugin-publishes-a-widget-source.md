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
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
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
---

`@nextlyhq/plugin-seo` now publishes a dashboard data source, `plugin:seo/issues`,
counting the SEO gaps in the collections it was configured to extend — documents
missing a meta title, canonical URL, meta description or social image, and
documents hidden from search engines by `noindex`.

It is the first plugin to use `contributes.widgetSources`, and it is built
entirely from `@nextlyhq/plugin-sdk`: nothing it imports is unavailable to a
third-party plugin, which is what makes it a reference rather than a
demonstration.

Every read is scoped to the caller through `callerReadOptions`, so the number
describes what that reader can see; a collection they cannot read contributes
zero rather than failing the card. The scan is bounded, and past the bound the
answer reports a floor rather than a figure that is quietly too small — the
fields live in a JSON column that a database-side `count` cannot filter on, so
the rows are read and inspected. It also honours the resolver cancellation
signal, stopping between pages once the dashboard has given up waiting.
