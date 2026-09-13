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

Saving a component could do far more work than its bound said. Before a save,
each of the component's variants is composed to check that the component does
not end up referencing itself, and that work was charged only for the
component's own nodes. A small component placing a large one composed the large
one again under every variant, and a large component naming itself was not
checked at all on a save made without the Direct API.

Each composition is now charged, by the composer itself, for every entry it
examines, including expansions it abandons and nodes an override hides, against
one allowance per save. A save that spends it is refused, and the message says
what the author can change. `resolveComponentInstances` takes that allowance as
the `work` option, and reports `loopsClosed`, every component a reference loop
closed on, so a loop found just before the allowance ran out is still named as a
loop rather than as spent work.
