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

Every access rule is handed one context, and a permission is spelled one way.

A collection's, a Single's and a field's rule now receive the same
`AccessRuleContext` (`AccessControlContext` is the same type, and a field's
`AccessFunction` takes it too). It holds everything each kind of rule read
before: `user`, `roles`, `permissions`, `principal`, `operation` and
`collection`, as a collection rule read them, and `req`, `id` and `data`, as a
field rule read them. A collection rule now also gets `req`, a field rule now
also gets `user`, `operation` and `collection`, and every rule gets `target`,
`{ kind, slug }`: a `"collection"`, a `"single"`, or, for a field rule, the
`"component"` the field belongs to. A rule written against either earlier shape
reads what it read.

`permissions` is now spelled as the Roles screen, the database and a route's
`requiredPermission` spell it: `update-posts`. A rule that checks that spelling
allows; until now it was handed `posts:update` and refused. A permission whose
stored slug is custom, such as `manage-api-keys`, is handed as stored.

The earlier spelling, `posts:update`, is still in the list for this release,
after the new one, so a rule that looks a permission up keeps its answer. A
rule that reads the list's order, its length or its first entry sees the new
entries, which come first, and each permission twice. A rule that checks it
with `includes`, `indexOf` or `lastIndexOf` is warned once, naming the spelling
to write instead. It stops being accepted in a later release: change
``permissions.includes(`${collection}:${operation}`)`` to
``permissions.includes(`${operation}-${collection}`)``.

Code that builds a context by hand, such as a unit test of a rule, now has to
give `req` and `target` as well. The Form Builder's default rules and the blog
template's `hasPermission` check the new spelling.
