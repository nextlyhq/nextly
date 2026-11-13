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

A form's file field now has an upload route, and a submission's files are deleted with it.

`POST /admin/api/forms/:slug/upload` (multipart: `field` and `file`) stores a visitor's file for one file field of an open form and answers with its `mediaId`, the value the field's answer names. It refuses a form that is not open, a field that is not a file field, a type or size the field does not take (the field's `accept` and `maxFileSize`, never above the plugin's `uploads.maxFileSize`), and a visitor past five uploads per submission the rate limit allows.

The plugin records each upload, and a submission written by a request (a visitor, or staff over the API) may only name uploads made for its own form and field that no other submission has claimed; anything else is refused with a validation error on the field. An edit may send back the ids a submission already holds. A write no request produced (the Direct API from server code) is trusted as before, and one naming a file another submission holds is recorded as holding it too, so the file stays while either names it.

Deleting a submission, one at a time, in bulk, by the nightly retention pass or with its form, now deletes the files it holds once the deletion commits, unless something else on the site uses one. The nightly pass also deletes uploads no submission claimed within a day. Settings › Privacy says so.

A plugin's `ctx.services.media.delete` now removes the item's stored files durably: they are recorded as left to remove in the delete's own transaction, and the jobs queue retries a removal storage refused until the files are gone, rather than leaving them behind after a storage error.

Migration: the plugin adds an internal `form-uploads` collection. Existing installations receive it through their own migrations: run `nextly migrate:create` and then `nextly migrate` (or `nextly db:sync` in development). Files named by submissions stored before the upgrade were not recorded, so they are not deleted with them.

The plugin SDK also re-exports the `date` field factory and the `CollectionConfig` type, as part of its public field-authoring surface, so a plugin can author the collections it contributes without importing from core.
