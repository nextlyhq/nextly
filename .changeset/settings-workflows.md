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

Settings has a Workflows page. It lists each workflow defined in code, with the collections and Singles using it, and opens each one on its own page: its stages and steps as a diagram, read from the code, and the choices admins own about it. Admins choose which roles take each step (an exact set, with roles that hold a step on some collections only named, and steps sharing a permission changed together), the default reviewer of each review stage (only those holding the stage's main step are offered), each stage's label and colour from a fixed palette with a reset to the code's, and which notifications also send an email. The page says when no role holds a step and when a default reviewer, a person or a role, no longer holds its step. A reader with `read-settings` alone sees it all read-only, and changing who takes a step also needs `update-roles`.

The experimental workflow API answers what the page shows: `GET /workflows` adds each workflow's configuration file (`configPath`), what its diagram draws (each step's permission and comment rule, each stage's primary step and whether it is a review stage, `onEdit` and `afterPublish`) and how many documents are in each stage (`stageCounts`); the settings read adds whether each default reviewer still holds its step (`defaultReviewerHolds`) and the roles a review stage's default reviewer may be chosen from (`reviewerRoles`).
