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

What waits for a caller in a workflow is decided by one rule, the one a part's review state names. Work assigned to someone who can no longer take its stage's step now waits for everyone who can, and unassigned work waits for every holder unless the stage's default reviewer may take it. The waiting list (`GET /admin/api/workflows/waiting`, `nextly.workflows.waiting`) shows only stages whose next step the caller may take: no approval for an API key, and none for the person who brought the part into a stage that refuses self-approval. It lists and counts only parts the caller may read, so a hidden part never takes a place on a page or counts in `total`. An API key stands for its roles alone: it sees work assigned to its roles, never work assigned to its owner personally.
