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

Super-admin authority is decided in one place: from the roles a lookup finds for the caller.

- **A user handed in by server code is judged by the roles they hold.** A `user` handed to the Direct API, or to a service, that names the `super-admin` role (`role` or `roles`) without holding it is now judged like any other signed-in user: by their roles and permissions, at the collection and Single gates and when relationships are populated. A user who holds the role, directly or through an inherited one, passes as before. If your server code hands Nextly a user object, its `role`/`roles` fields no longer grant anything; pass the user's id and let Nextly look them up, or use `overrideAccess: true` for trusted server work.
- **A plugin's signed-in person is judged as the person** when relationships are populated, whatever user the read also names.
- **The schema journal (`GET /api/schema/journal`) is read by a super-admin's session; an API key is refused.** The admin's notification bell reads it through the session and is unchanged.
