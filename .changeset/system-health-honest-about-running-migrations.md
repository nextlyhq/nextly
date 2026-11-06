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

System health is more careful about what it confirms:

- A migration another process is applying (a CLI, or a second instance during a rolling deployment) reads as pending while its attempt is less than ten minutes old, the same threshold a schema change is judged by, and as failed only once it is older and still unfinished. Before, it read as failed as soon as this process's own boot migrations had settled.
- The migrations line reads "Couldn't check" when the answer's schema-change result is missing or malformed, instead of "Up to date": only a schema-change result plus migrations "ok" reads healthy.
- The version line reads "Couldn't check" when the answer carries no version, instead of a green "Nextly unknown".
- A storage failure's age ("Last write failed 5m ago") now keeps counting while the dashboard stays open, on the same minute clock the other dashboard cards use.
- A failed collection schema change followed by a successful retry in the same millisecond is now resolved by the retry on every database: the schema ledger stamps each collection's (and each Single's and component's) schema changes in strictly increasing start times, as it already did for each migration's records.
