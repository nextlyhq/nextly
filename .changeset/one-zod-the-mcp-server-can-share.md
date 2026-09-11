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
"@nextlyhq/plugin-form-builder": patch
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

zod is 4.6 now, from 4.1. The MCP server library needs 4.2 or newer, and a
second copy of zod beside the first would make every schema a stranger to the
other's `instanceof`; one version everywhere is what lets the coming MCP plugin
describe its tools in the same language the rest of Nextly describes content.

One behaviour moved with it. zod's JSON Schema converter now refuses a schema
whose registrations collide on an `id` rather than emitting a shorter schema,
which is the corruption the block document emitter already refused; the
emitter turns that refusal into its own, so a caller still sees one error for
one reason, and a document checked against a derivation that cannot be made is
answered rather than thrown at.
