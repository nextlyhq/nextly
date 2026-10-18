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

A release's documents are checked before the moment, and a hard problem stops
scheduling. `GET /api/releases/:id/readiness` and `nextly.releases.readiness()`
report each document's hard problems (no author, an author who is gone or may
no longer publish or unpublish it, a document that is gone, a collection or
Single without a draft/published lifecycle or whose translations lack a
per-language status, unreleased work held in another language, a document going live that fails validation or edits
a field its author may no longer write) and soft ones (another scheduled release holds it,
and which one wins). Every document is checked, however many the release holds.
Scheduling, Publish now and adding a document to a scheduled release are refused
while a hard problem stands, as a `409 CONFLICT` naming each problem in
`data.problems`, alike over REST and the Direct API. A document coming down is
never validated. `PATCH /api/releases/:id/members/:memberId` and
`nextly.releases.changeMemberAction()` switch a document between going live and
coming down, checking the new action as the document's author in a scheduled
release. The blocking reasons are now derived from the same checks. All of this
is experimental. Publish now judges each member by its author, as the scheduled
run does.
