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

The SEO plugin's dashboard card is now declared with `defineWidget` under `contributes.dashboard`, as any plugin's widget is. The card, `seo/issues`, draws one bar per kind of issue in the collections the plugin extends, from a `load` that reads through the services bound to the person asking, so the numbers are what that person may see. It is offered to a person who may read every one of those collections. The issue count is also on the Needs attention card, as one line per collection (`seo/issues-<collection>`, "SEO issues in <collection>"): each shows only to a reader of its collection, counts that collection's issues and links to its list, so every line a reader is shown opens. Needs attention lists up to 10 SEO collections, the most lines core takes from one plugin: the first ten configured get a line each, and the card covers all of them.

A widget's data reads gain one option: `services.find` takes `depth: 0` to return links as their stored ids, unexpanded, where a read naming no depth still expands them as before. `0` is the only depth a read may name. The SEO scan reads at `depth: 0`, so a page's social image is judged by the id it stores: a reader who may not read media is no longer told every page with an image is missing one, and an image whose file is gone counts as present, as it did before.

Removed from `@nextlyhq/plugin-seo`, with nothing in their place: the `plugin:seo/issues` data source and `seoIssuesWidgetSource`, `issueFilter`, `SEO_ISSUES_SOURCE_ID`, `ISSUE_FIELD` and `ISSUE_SCAN_PAGE_SIZE`, and `seoIssuesWidget`, the stats card. The card and the Needs attention line reach the dashboard through `seoPlugin`; `SEO_ISSUES_WIDGET_ID` names the card in a site's `admin.dashboard`.
