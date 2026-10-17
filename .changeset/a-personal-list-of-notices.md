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
---

Every admin user now has a personal list of notices: things that happened to
their work that they should know about. A notice is for one person only, is
stored once per occurrence, keeps a snapshot of what it is about so it still
reads after that is deleted, and records when it was read. Read them with
`GET /api/notices`, count them with `GET /api/notices/count`, and mark them
read with `POST /api/notices/read`, all for the signed-in person (API keys are
refused); or from server code with `nextly.notices.find()`, `count()` and
`markRead()`. Notices are kept as long as the activity log keeps its records,
and are deleted with their person. Core features add their own kinds of notice
through one registered, typed kind; plugins cannot add kinds yet. All of this
is experimental.

**Run `nextly migrate`** to create the `nextly_notices` table on an existing
installation. Until then lists are empty, nothing is recorded, and one warning
names the table and the command.
