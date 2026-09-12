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
---

The setup checklist offers a reader only the steps they could actually finish.
A step is withheld where the install has observed that this reader cannot take
it -- they may read a collection but hold `create-<slug>` on none, or they
cannot create a collection at all -- and the "is onboarding done" question is
answered over the steps that remain. Before, both were derived from what the
reader may READ: an editor without a create grant had the first-entry step
outstanding permanently, its link landing on a surface that refused them, and
the card pinned to their dashboard for the life of their account.

A finished step stays on the list whoever the reader is. It records what the
install has done rather than offering them work, so withholding it would only
make their progress look smaller than it is.

The step is decided by the same authorization a write performs, so a scoped API
key whose collection refuses its `access.create` rule is not offered a step that
write would refuse. The grant that authorizes creating a collection is declared
once and read by the two routes that enforce it as well as by the checklist.
