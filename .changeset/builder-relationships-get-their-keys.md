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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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

The Schema Builder now keys a relationship made in the admin. A relationship whose target is named by `relationTo`, as the admin writes it, gets its foreign key to the target collection's table when its collection is created or when the relationship is added, on PostgreSQL, MySQL and SQLite. A relationship to Users, a Single, several collections, or one holding several entries gets no key.

Behaviour change, for relationships created or added from this release on (existing ones keep no key and nothing is planned for them on upgrade):

- Deleting an entry that a required relationship still points at is refused, with a message naming the collection, the field and how many entries point at it, instead of "Referenced record does not exist.". A bulk delete reports each such entry and deletes the others.
- Deleting an entry that an optional relationship points at empties that relationship in the database. The referring entries' hooks, versions and webhooks do not run for that change.
- Saving a relationship to an id that does not exist is refused by the database.
- A save that points a keyed relationship at another collection is refused before anything runs, naming the field; the key stays. Switching it to hold several entries still converts each value into a one-item list, the key going with the conversion.

A relationship whose `relationTo` names a different collection from its `options.target` is no longer keyed to the `options.target` table, since its values are ids of the `relationTo` collection. Deleting several collections together orders the drops by the keys the database actually holds.
