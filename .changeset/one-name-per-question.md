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

Two names each meant two different things depending on which entry point you
imported from, and nothing at the call site said which had arrived.

`isFieldGroupType` was a one-argument boolean test on `nextly` and a
two-argument type guard on `nextly/field-group-type`. The guard keeps the name,
because it is the one application code writes when rendering a dynamic zone:
`isFieldGroupType(block, "hero")`. The token test is `isFieldGroupFieldType`,
which is not a new coinage: `nextly/field-group-type` was already re-exporting
it under exactly that alias, with a comment explaining that the two predicates
had to be kept apart. The alias is the real name now, so no entry publishes the
spelling it was working around.

`createAdapter` was the database factory on `nextly` and `nextly/database`, and
the CLI's own on `nextly/cli/utils`. They return different types. The factory
keeps the name, since it builds the `DrizzleAdapter` an application runs on; the
CLI's is `createCliAdapter`, returning the small `CLIDatabaseAdapter` that is
connect, disconnect and a dialect.

Neither name appears in the docs or any template, so nothing published changes
for a reader.

The list of known clashes in the export-contract test is now EMPTY, which is the
part that lasts. It held these two, recorded rather than fixed because each
needed the decision `getNextly` needed. With both made, nothing is exempt and
the next such name fails on the day it appears instead of joining a list.
