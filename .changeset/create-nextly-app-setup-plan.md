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

The installer gains one setup plan behind every answer for a new project: how it starts, where it runs, the database, features, languages, image storage, coding tools and their rules, the package manager and git. Each answer left out takes the default the questions pre-select, so answering nothing makes the same plan as pressing Enter throughout; changing where the site runs resets the database and image storage, and changing the start resets the features. Combinations that will break, such as SQLite on Vercel, come back as warnings and never stop a run. The project name and the connection string are never part of the plan. The plan's JSON Schema is published as `create-nextly-app/setup-plan.schema.json`. Experimental: nothing reads the plan yet, and its shape may change until the guided installer is finished.
