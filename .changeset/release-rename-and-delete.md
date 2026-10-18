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

A content release can now be renamed and deleted, under two new permissions. `update-content-releases` lets a person change a release's title and description in any state, through `PATCH /api/releases/:id` or `nextly.releases.update()`. `delete-content-releases` lets a person delete a release that never ran, with its documents, through `DELETE /api/releases/:id` or `nextly.releases.delete()`: a draft, or a release cancelled before it was ever scheduled. Every other release is refused with a conflict whose `data.reason` says why: a scheduled or stopped release (`committed`) can be cancelled to call it off, and is then kept; a published one (`published`) stays as the record of what went live; and a cancelled release that was ever scheduled (`was-scheduled`) is kept as a record too, because nothing stored says whether it began to run before it was called off. The delete answers with the release as it was. Each rename and deletion is recorded in the activity log, and the capabilities sent with every release gain `update` and `delete`, so the admin can offer only what the caller may do. All of this is experimental until the releases redesign is complete.

An existing installation receives both permissions the first time it boots, granted so that nobody gains or loses anything: super-admins hold both, every role holding `create-content-releases` gains `update-content-releases`, and every role holding `publish-content-releases` gains `delete-content-releases`. The grants are made once, when the permissions are created, so a permission an administrator later takes from a role is not given back on the next restart.
