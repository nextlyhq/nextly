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

Deleting a component that a Layout still uses is now refused, and the message
names the Layouts to go and edit. A Layout wraps every page assigned to it, so
removing a component it uses would leave a gap on all of them at once — unlike
an ordinary page, where the renderer draws one visible, recoverable
placeholder.

Draft Layouts count. A component named only by an unpublished Layout is on no
page yet, and deleting it would break that Layout the moment someone publishes,
by which time the cause is a deletion nobody remembers.

The database could not have caught this: a Layout's areas are stored as one
JSON column, so the reference to the component emits no foreign key.
