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

The dashboard's Count card reads well at any number. It shows what it counts, the number written whole ("12,480", never "12.5k"), and one line under it: by default the change this week ("+3 this week", "No change this week"). In its settings, "Count" chooses all entries, the published ones or the drafts, and "Under the number" chooses the change this week, a trend line over the last 8 weeks, a status split, or nothing. Every line counts what the number counts, so a Drafts card's change counts only drafts, and the status split is offered only with all entries. A reader who may read users can also set a Count card to Users, to count the people on the site; a reader who may not is never offered Users, and the server refuses a card set to it. Recent entries rows no longer start with a letter square: each row leads with its title and shows its status as a quiet chip with a dot. Upcoming releases keeps its date chip.
