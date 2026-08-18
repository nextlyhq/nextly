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
---

Reading a past version is now read-only all the way through, and can be acted on from where it is
read. The save controls stand down while a version is on screen — they act on the live document,
which is not what is being read — and restoring is offered from the banner over the version itself.

Three things that stayed editable are fixed with it. The title and the slug are part of the
document, so they lock with the rest of it rather than quietly changing the live entry from a
historical page. The set of fields a version shows is now decided by that version's own values, so
a document whose layout has changed since is not shown through today's layout. And returning to the
live document clears the panel's selection too, so no row stays marked as the version on screen.
