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

Review state is read and moved through REST and the Direct API (experimental). `GET /admin/api/workflows/review-state` and `nextly.workflows.reviewState` show each part of a document with its stage, the steps out of it, who it waits for (`waitingFor`) and its last move (`lastMove`). Each step says whether the caller may take it (`mayTake`, judged by the checks the step itself makes) and which one is the stage's primary step (`primary`). A document with no workflow attached answers `200` with `{ workflow: null, parts: [] }`. `POST /admin/api/workflows/steps` and `/steps/bulk` take a step on one document or several, each refusal named. `POST /admin/api/workflows/assignments` and `/assignments/bulk` assign parts. `GET /admin/api/workflows/waiting` lists what waits for the caller. A caller who may not read a document is answered as though it did not exist.

A workflow's settings (default reviewers, stage labels and colours, email switches, and which roles hold each step) are read and changed at `GET` and `PATCH /admin/api/workflows/{slug}/settings` and through `nextly.workflows.settings`, guarded as other settings are, and recorded in the settings history. `grants` is an exact set: saving a step leaves exactly the listed roles holding its permission on every attached collection and Single. The read shows the roles that hold it on only some of them (`partialRoles`) and the steps that share its permission (`sharesPermissionWith`). A default reviewer's eligibility is judged with the grants the same write is about to store.

Workflow steps are taken on Singles, and the publish gate now judges a Single's publish: a Single with a workflow attached publishes only its approved parts, through every door. A publish of every language of a Single, and a save of every language, are judged only for the languages they move.
