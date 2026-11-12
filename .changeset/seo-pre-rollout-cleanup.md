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

The SEO plugin's tab and its problem list count a page's title and description by one check, so their counts agree: a title in emoji is counted in characters by both, and a page hidden from search has no title or description problem in either. The problem list now checks the Singles the plugin extends too, on their save and in a full check, and shows each to whoever may read it.

The dashboard's **SEO issues** card now draws what the problem list finds, by kind, and its Needs attention line is one **SEO problems** line counting the whole list and linking to it, each read as the person looking may read the list. They replace the card's count of empty fields and the line per collection. Redirect chains, which the list names only to someone holding `manage-seo`, stay on the list. The package no longer exports `issuesFor`, `checksFor`, `reportableIssues`, `ISSUE_SCAN_ROW_BUDGET` and the `IssueChecks` type, which counted empty fields for the old card: read the problem list instead.

The SEO tab's link to the check of what search engines received names the page at the address its language serves it at, with the language in it on a site that puts the language in every address. The Pages and addresses screen's panel is drawn with the SEO tab's own parts, and the SEO screens' styles no longer use `!important`.
