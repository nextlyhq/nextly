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

**Breaking:** a restore through the APIs writes the working draft and never publishes. Restoring
a version through REST (`POST …/versions/{n}/restore`) no longer writes the live document or its
status: the chosen fields (all of them by default, or the ones `fields` names) go into the drafts
of the parts the version holds, and what readers see stays as it is until the draft is
published. A collection or Single kept without drafts (`versions: { drafts: false }`, or no
`status`) has no draft to write, so its restore is now refused with `422 BUSINESS_RULE_VIOLATION`
before anything changes. To put a version back live there, edit the values back, or turn drafts
on and publish the restored draft.

The Direct API gains `nextly.versions` (`list`, `get`, `compare`, `name`, `restore`,
`markSeen`), and plugins gain `ctx.services.versions.restore`; both are experimental. Each
restored value records the version it came from: a restore records its own, and a save names
its restored fields in `_restoredFrom`. Retention keeps every version a recorded source names.

**Storage:** the versions table gains a nullable `field_sources` column. `nextly migrate` and
start-up add it to an existing database, with no migration file and no change to existing rows.
