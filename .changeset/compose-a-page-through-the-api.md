---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
---

Everything an editor does to compose a page can now be done through the API,
with a dry run first.

`POST /pages/actions` inserts a pattern, places a component (with a variant and
values), changes a placement's values or variant, and chooses a page's Layout.
`POST /components/:id/definition` exposes, renames, retargets and removes a
component's fields and adds, renames and deletes its variants and their values,
held to the same rules as the component's own view. `save-as-pattern` takes
`dryRun` too.

A dry run makes the write as the caller and rolls it back, so it answers what
the site would refuse. Every answer carries a `fingerprint`; sent back as
`expect`, an apply refuses with 409 when the item changed since. Each answer
says who it ran as, a person or an API key. These routes are experimental.
