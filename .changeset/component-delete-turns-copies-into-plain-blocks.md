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

The Page Builder can delete a component that pages use, turning every copy into plain blocks first. `POST /components/:id/delete` (with `dryRun` for the plan) and `GET` for progress run the delete as the person who started it, one bounded step per request: a check before anything changes (a Layout using it, a copy that cannot be converted, or a document they may not change stops it with nothing changed), the conversion, then the delete. Before each step it asks core's new `mayDeleteEntry` (in `@nextlyhq/plugin-sdk`, experimental) whether the person may delete that component: the delete's own gate, a rule over the row included, with no hook run and nothing written. A save already in flight is judged again inside its own transaction, and a deleted component leaves a lasting record that refuses any save still holding it, so no save leaves a copy of it. A component's own delete now goes only through this action, and unpublishing a component that documents use is refused, naming them; when the usage index names none, every document is read to confirm it.
