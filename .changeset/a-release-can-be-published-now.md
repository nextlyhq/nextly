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

A release can be published now: `POST /api/releases/:id/publish` and
`nextly.releases.publishNow({ id })` run a draft or scheduled release at once,
with the same checks as scheduling, by moving it to the current time (unless
it is already due) and starting the job runner's releases run straight away,
and answer the release as it then stands. When a releases run is already in progress, the release goes
out with it (or with the next one) and the answer says it is still scheduled.
Each release in a list also says whether the reader may publish it now
(`can.publishNow`). Both are experimental. The capabilities type,
`ReleaseCapabilities`, is now exported from `nextly/schemas`, and the admin
reads its release controls from it.

**Behaviour change:** a cancelled release is now final, like a published one.
It can no longer be scheduled again, and documents can no longer be added to or
removed from it; create a new release instead. A stopped release can still be
fixed and scheduled again.
