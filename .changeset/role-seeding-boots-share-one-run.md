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
---

When one boot finds the services already registered by the other, as when
`instrumentation.ts` and a first request boot at the same time, it now waits for
that boot's permission and role seeding rather than serving before the roles are
written. The registering boot holds that wait from before its services read as
registered, so the steps it runs before seeding are covered too, and so is a
development boot that registers the services again after a `localization`
change. Both boots share one seeding run per process.

A plugin-declared role is created only once a boot has seeded every
permission. A plugin role is never revisited after it exists, so one created
after a permission step that failed part-way kept, for good, only the grants
that step managed to write. A permission seeding counts as failed when any
permission could not be written, or when the collection or Single registry
could not be read for a reason other than its table not existing yet; it is
logged as an error naming how many.

On MySQL, whose `role_permissions` table has no foreign key, an assignment
whose permission no longer exists is left out of a role's permission list and
removed by the next replacement, rather than failing the read. A replacement
that adds an id naming no permission is refused on every dialect, MySQL
included, and leaves the role as it was. Replacing a role's permissions removes
and inserts in statements within the adapter's parameter limit, however many
assignments change.
