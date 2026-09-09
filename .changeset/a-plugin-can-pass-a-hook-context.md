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

A plugin can pass a hook context. `ctx.services.collections` operations take an optional `context`, which reaches this operation's hooks as `ctx.context`. It is how a caller tells a hook something about the CALL that the row cannot say.

Core has accepted this on every collection operation for a while and seeds the shared hook context from it. The plugin facade rebuilt its trailing argument as `{ user, overrideAccess }` and dropped everything else, and `CollectionService` forwarded only those two, so nothing above could reach it.

It is data, not permission: nothing passed here bypasses access, validation or any hook. A hook decides for itself what to do with what it is told.

The form-builder plugin uses it for the case that prompted it. A submission write reads its parent form only to check the payload against that form's fields, and the form's `afterRead` hook was counting that form's submissions on the way past. That count is presentation work nobody on the write path reads, and it grows with the form's history, so every submission paid for a count of every submission before it. The write now says it wants the schema alone, and the hook skips the count.
