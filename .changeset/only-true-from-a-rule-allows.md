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

A code access rule now allows only by returning `true`. A rule that returns `null`, `undefined`, a string or any other value refuses, as `false` does, for every caller and at every way in. Before, a visitor was refused only by `false`, so `null` and `undefined` let one through, and a signed-in user was let in by any truthy value. Return `true` to allow.

`ctx.caller.can` in a plugin route and `nextly.access.check` now return a boolean. Before, a rule's own answer could come back as it was, `null` or a string included.

For this release, each request refused this way that a rule allowed before is logged once, naming the collection or Single, the action and the kind of caller, so a rule that relied on the old reading can be found and changed.
