---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

Generated types and Zod schemas now declare the publish lifecycle.

A collection or Single that sets `status: true` carries a draft/published
column, and the generated artifacts said nothing about it — so a consumer of
your generated types could not tell a draft from a published entry, which is
the one distinction the lifecycle exists to express.

Both artifacts now emit `status: "draft" | "published"` for those records, and
nothing at all for the ones that do not declare it.

The set comes from `LIFECYCLE_STATUSES` rather than being typed out, because
its own docblock says it is stated once so that callers rejecting other values
do not write the rejection from memory. Adding a status there now widens the
generated type and the generated validator together.

It is deliberately NOT `VersionStatus`. That union also carries `"unpublished"`,
which describes a row in the version history rather than an entry, and no entry
is ever written with it — offering it would send consumers down a branch that
cannot occur.

The member is neither optional nor nullable: the column is `NOT NULL DEFAULT
'draft'`, so a read always has a value.
