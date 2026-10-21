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

A release now keeps its own history in the record of content events. Each release operation records an event, with the release as its subject, in the same transaction as the change: created, documents added, removed or switched between going live and coming down, scheduled, rescheduled, Publish now, started, published, stopped, cancelled, renamed, description changed and deleted. Each names who acted: the person, an API key by its own id and name (never the person who owns the key), or the system for the run and its stops. Read it with `GET /api/content-events?subject=release&id=<id>` or `nextly.contentEvents.list({ subject: { kind: "release", id } })`.

A cancelled release that was scheduled can now be deleted when its history shows it never began publishing: one scheduled and cancelled before its moment goes, while one that started publishing (stopped part-way, or cancelled mid-run) is still kept with `was-scheduled`. A release created before this version has no recorded history and keeps the earlier rule. **Compatibility:** a Direct API call to a release write that forwards an API key's `authenticatedScope` must now pass the key's `apiKeyId` with it, so the change can name the key; one without it is refused with `INVALID_INPUT` before anything is written. REST requests carry the key's id already. All of this is experimental until the releases redesign is complete.
